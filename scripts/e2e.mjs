// Runs Till's whole loop on the live testnets and times it:
//   create an invoice on the home chain -> pay it with a plain USDC transfer on another chain ->
//   Reactive hears the Transfer -> the invoice is marked paid at home and the money is swept.
//
//   npm run e2e                               pay 0.10 USDC on Unichain Sepolia
//   npm run e2e -- sepolia 0.25               pay 0.25 USDC on Ethereum Sepolia
//   npm run e2e -- unichainSepolia 0.1 5      five rounds, then a latency summary
//
// The deployer is both seller and payer here, so the test USDC comes straight back.
import { formatUnits, parseEventLogs, parseUnits } from 'viem'
import {
  ERC20_ABI, HOME, REACTIVE, account, artifact, loadDeployments, network, publicClient, sleep, txOverrides, txUrl,
  waitFor, walletClient,
} from './lib.mjs'

const [payOn = 'unichainSepolia', amountArg = '0.10', roundsArg = '1'] = process.argv.slice(2)
const amount = parseUnits(amountArg, 6)
const rounds = Number(roundsArg)

const d = loadDeployments()
if (!d.home?.invoiceBook || !d.payChains?.[payOn]) throw new Error(`Till is not deployed for ${payOn}. Run \`npm run deploy\`.`)

const me = account().address
const bookAbi = artifact('InvoiceBook').abi
const tillAbi = artifact('TillReactive').abi
const collectorAbi = artifact('Collector').abi
const home = publicClient(HOME)
const pay = publicClient(payOn)
const reactive = publicClient(REACTIVE)
const usdc = d.payChains[payOn].usdc

const blockTime = async (client, blockNumber) => Number((await client.getBlock({ blockNumber })).timestamp)

/** First log of `eventName` for this invoice id, from `fromBlock` on. */
async function findEvent(client, address, abi, eventName, id, fromBlock) {
  const logs = await client.getContractEvents({ address, abi, eventName, args: { id, invoiceId: id }, fromBlock })
  return logs[0] ?? null
}

async function round(i) {
  console.log(`\n── Round ${i + 1} of ${rounds}: ${amountArg} USDC, paid on ${network(payOn).name}, books on ${network(HOME).name} ──`)

  const balance = await pay.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [me] })
  if (balance < amount) {
    throw new Error(`Need ${amountArg} test USDC on ${network(payOn).name}, have ${formatUnits(balance, 6)}. Get some at https://faucet.circle.com`)
  }

  // 1. Create the invoice on the home chain.
  const reactiveFrom = await reactive.getBlockNumber()
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const createHash = await walletClient(HOME).writeContract({
    address: d.home.invoiceBook, abi: bookAbi, functionName: 'createInvoice',
    args: [me, amount, expiresAt, `Till e2e ${new Date().toISOString()}`],
  })
  const createReceipt = await home.waitForTransactionReceipt({ hash: createHash })
  const created = parseEventLogs({ abi: bookAbi, logs: createReceipt.logs, eventName: 'InvoiceCreated' })[0].args
  console.log(`1. Invoice created     ${txUrl(HOME, createHash)}`)
  console.log(`   id ${created.id}`)
  console.log(`   deposit address ${created.depositAddress} (same on every chain, no code there yet)`)

  // 2. Reactive hears InvoiceCreated and starts watching the deposit address.
  const watching = await waitFor(
    () => findEvent(reactive, d.reactive.till, tillAbi, 'Watching', created.id, reactiveFrom),
    { what: 'Till to start watching the deposit address' },
  )
  console.log(`2. Till is watching    ${txUrl(REACTIVE, watching.transactionHash)}`)

  // 3. Pay: a plain ERC-20 transfer on the pay chain. No Till contract is called.
  const homeFrom = await home.getBlockNumber()
  const reactiveFrom2 = await reactive.getBlockNumber()
  const payHash = await walletClient(payOn).writeContract({
    address: usdc, abi: ERC20_ABI, functionName: 'transfer', args: [created.depositAddress, amount],
    ...(await txOverrides(payOn)),
  })
  const payReceipt = await pay.waitForTransactionReceipt({ hash: payHash, pollingInterval: 100 })
  const payMinedAt = Date.now()
  if (payReceipt.status !== 'success') throw new Error(`Payment failed: ${txUrl(payOn, payHash)}`)
  console.log(`3. Paid                ${txUrl(payOn, payHash)}`)

  // 4. The invoice marks itself paid on the home chain.
  const paid = await waitFor(
    () => findEvent(home, d.home.invoiceBook, bookAbi, 'InvoicePaid', created.id, homeFrom),
    { everyMs: 150, what: 'the invoice to be marked paid' },
  )
  const paidSeenAt = Date.now()

  const seen = await waitFor(
    () => findEvent(reactive, d.reactive.till, tillAbi, 'PaymentSeen', created.id, reactiveFrom2),
    { what: "Till's reactive transaction" },
  )
  const swept = await waitFor(
    () => findEvent(pay, d.payChains[payOn].collector, collectorAbi, 'Swept', created.id, payReceipt.blockNumber),
    { what: 'the sweep callback' },
  )
  console.log(`4. Reactive reacted    ${txUrl(REACTIVE, seen.transactionHash)}`)
  console.log(`5. Marked PAID at home ${txUrl(HOME, paid.transactionHash)}`)
  console.log(`6. Swept to the seller ${txUrl(payOn, swept.transactionHash)}`)

  const [tPay, tSeen, tPaid, tSwept] = await Promise.all([
    blockTime(pay, payReceipt.blockNumber),
    blockTime(reactive, seen.blockNumber),
    blockTime(home, paid.blockNumber),
    blockTime(pay, swept.blockNumber),
  ])
  const result = {
    invoiceId: created.id,
    payOn,
    txs: {
      create: createHash, watching: watching.transactionHash, pay: payHash, react: seen.transactionHash,
      paid: paid.transactionHash, swept: swept.transactionHash,
    },
    // Block timestamps are whole seconds, so these are accurate to about a second.
    secondsPayToReact: tSeen - tPay,
    secondsPayToPaid: tPaid - tPay,
    secondsPayToSwept: tSwept - tPay,
    // Wall clock on this machine, from seeing the payment mined to seeing the invoice paid.
    observedMs: paidSeenAt - payMinedAt,
  }
  console.log(
    `   Payment -> PAID: ${result.secondsPayToPaid}s by block time (react at +${result.secondsPayToReact}s, swept at +${result.secondsPayToSwept}s); ${result.observedMs} ms observed here`,
  )
  return result
}

const results = []
for (let i = 0; i < rounds; i++) {
  results.push(await round(i))
  if (i < rounds - 1) await sleep(2000)
}

if (rounds > 1) {
  const sorted = (xs) => [...xs].sort((a, b) => a - b)
  const median = (xs) => sorted(xs)[Math.floor(xs.length / 2)]
  const by = (k) => results.map((r) => r[k])
  console.log(`\n── ${rounds} rounds on ${network(payOn).name} ──`)
  console.log(`Payment -> PAID, block time: median ${median(by('secondsPayToPaid'))}s, min ${sorted(by('secondsPayToPaid'))[0]}s, max ${sorted(by('secondsPayToPaid')).at(-1)}s`)
  console.log(`Payment -> PAID, observed:   median ${median(by('observedMs'))} ms`)
}
console.log('\n' + JSON.stringify(results, null, 2))
