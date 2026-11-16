// Deploys Till. Safe to run again: it skips whatever deployments/<name>.json says is already done.
//   npm run deploy
//
// Order matters (see https://dev.reactive.network/callback-contracts#deployment-order):
//   1. ForwarderFactory on every pay chain, at the same address everywhere (CREATE2)
//   2. TillReactive on Reactive
//   3. Collector on every pay chain, InvoiceBook on the home chain (both need TillReactive's address)
//   4. Tell TillReactive where they are
import { concat, formatEther, getContractAddress, parseEther } from 'viem'
import {
  CREATE2_DEPLOYER, FACTORY_SALT, HOME, PAY_CHAINS, REACTIVE, account, addressUrl, artifact, loadDeployments,
  network, publicClient, saveDeployments, txOverrides, txUrl, walletClient,
} from './lib.mjs'

const TILL_FUND = parseEther(process.env.TILL_FUND_REACT || '2') // REACT for reactive transactions
const CALLBACK_FUND = parseEther(process.env.CALLBACK_FUND_ETH || '0.0005') // native coin for callbacks

const me = account().address
const d = loadDeployments()

async function mined(key, hash, what) {
  const receipt = await publicClient(key).waitForTransactionReceipt({ hash, timeout: 180_000 })
  if (receipt.status !== 'success') throw new Error(`${what} failed: ${txUrl(key, hash)}`)
  console.log(`  ok  ${what}\n      ${txUrl(key, hash)}`)
  return receipt
}

async function deploy(key, name, args, value, what) {
  const { abi, bytecode } = artifact(name)
  const hash = await walletClient(key).deployContract({ abi, bytecode, args, value, ...(await txOverrides(key)) })
  const receipt = await mined(key, hash, what)
  return { address: receipt.contractAddress, block: Number(receipt.blockNumber) }
}

console.log(`Deployer ${me}`)
console.log(`Home chain: ${network(HOME).name}. Pay chains: ${PAY_CHAINS.map((k) => network(k).name).join(', ')}.\n`)

// ── 1. ForwarderFactory, same address on every pay chain ──
const factoryInitCode = artifact('ForwarderFactory').bytecode
const factory = getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt: FACTORY_SALT, bytecode: factoryInitCode })
console.log(`1. ForwarderFactory at ${factory} on every chain`)
for (const key of PAY_CHAINS) {
  const client = publicClient(key)
  if (await client.getCode({ address: factory })) {
    console.log(`  --  already on ${network(key).name}`)
    continue
  }
  const hash = await walletClient(key).sendTransaction({ to: CREATE2_DEPLOYER, data: concat([FACTORY_SALT, factoryInitCode]) })
  await mined(key, hash, `ForwarderFactory on ${network(key).name}`)
  if (!(await client.getCode({ address: factory }))) throw new Error(`Factory did not land at ${factory} on ${key}`)
}
d.factory = factory
saveDeployments(d)

// ── 2. TillReactive on Reactive ──
console.log(`\n2. TillReactive on ${network(REACTIVE).name}`)
if (d.reactive?.till) {
  console.log(`  --  already at ${d.reactive.till}`)
} else {
  const balance = await publicClient(REACTIVE).getBalance({ address: me })
  if (balance < TILL_FUND + parseEther('0.5')) {
    throw new Error(
      `Need about ${formatEther(TILL_FUND + parseEther('0.5'))} ${network(REACTIVE).symbol} on ${network(REACTIVE).name}, have ${formatEther(balance)}. Run \`npm run faucet\`.`,
    )
  }
  const till = await deploy(REACTIVE, 'TillReactive', [], TILL_FUND, `TillReactive, funded with ${formatEther(TILL_FUND)} ${network(REACTIVE).symbol}`)
  d.reactive = { network: REACTIVE, chainId: network(REACTIVE).id, till: till.address, fromBlock: till.block }
  saveDeployments(d)
}
const till = d.reactive.till

// ── 3. Collectors and the InvoiceBook ──
console.log('\n3. Callback contracts')
d.payChains ??= {}
for (const key of PAY_CHAINS) {
  const n = network(key)
  if (d.payChains[key]?.collector) {
    console.log(`  --  Collector already on ${n.name} at ${d.payChains[key].collector}`)
    continue
  }
  const c = await deploy(key, 'Collector', [n.callbackProxy, till, factory], CALLBACK_FUND, `Collector on ${n.name}`)
  d.payChains[key] = { chainId: n.id, usdc: n.usdc, collector: c.address, fromBlock: c.block }
  saveDeployments(d)
}
if (d.home?.invoiceBook) {
  console.log(`  --  InvoiceBook already on ${network(HOME).name} at ${d.home.invoiceBook}`)
} else {
  const n = network(HOME)
  const b = await deploy(HOME, 'InvoiceBook', [n.callbackProxy, till, factory], CALLBACK_FUND, `InvoiceBook on ${n.name}`)
  d.home = { network: HOME, chainId: n.id, invoiceBook: b.address, fromBlock: b.block }
  saveDeployments(d)
}

// ── 4. Point TillReactive at them ──
console.log('\n4. Configure TillReactive')
const tillAbi = artifact('TillReactive').abi
const reactive = publicClient(REACTIVE)
const currentBook = await reactive.readContract({ address: till, abi: tillAbi, functionName: 'invoiceBook' })
if (currentBook.toLowerCase() === d.home.invoiceBook.toLowerCase()) {
  console.log('  --  home already set')
} else {
  const hash = await walletClient(REACTIVE).writeContract({
    address: till, abi: tillAbi, functionName: 'setHome', args: [BigInt(d.home.chainId), d.home.invoiceBook],
    ...(await txOverrides(REACTIVE)),
  })
  await mined(REACTIVE, hash, 'setHome: subscribed to InvoiceCreated and InvoiceCancelled')
}
const known = await reactive.readContract({ address: till, abi: tillAbi, functionName: 'payChains' })
for (const key of PAY_CHAINS) {
  const p = d.payChains[key]
  if (known.some((k) => Number(k.chainId) === p.chainId)) {
    console.log(`  --  ${network(key).name} already a pay chain`)
    continue
  }
  const hash = await walletClient(REACTIVE).writeContract({
    address: till, abi: tillAbi, functionName: 'addPayChain', args: [BigInt(p.chainId), p.usdc, p.collector],
    ...(await txOverrides(REACTIVE)),
  })
  await mined(REACTIVE, hash, `addPayChain: ${network(key).name}`)
}

console.log('\nDone. Addresses are in deployments/.')
console.log(`  TillReactive   ${addressUrl(REACTIVE, till)}`)
console.log(`  InvoiceBook    ${addressUrl(HOME, d.home.invoiceBook)}`)
for (const key of PAY_CHAINS) console.log(`  Collector      ${addressUrl(key, d.payChains[key].collector)}`)
console.log('\nNext: `npm run e2e` creates an invoice, pays it on another chain and times the loop.')
