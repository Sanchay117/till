// Shows what the deployer holds on every chain, and how much gas money each Till contract has left.
//   npm run balances
import { formatEther, formatUnits } from 'viem'
import {
  ERC20_ABI, HOME, PAYABLE_ABI, PAY_CHAINS, REACTIVE, SYSTEM, account, loadDeployments, network, publicClient,
} from './lib.mjs'

const me = account().address
const d = loadDeployments()
console.log(`Deployer ${me}\n`)

const keys = [REACTIVE, ...new Set([HOME, ...PAY_CHAINS])]
for (const key of keys) {
  const n = network(key)
  const client = publicClient(key)
  const native = await client.getBalance({ address: me })
  let line = `${n.name.padEnd(18)} ${formatEther(native).slice(0, 12).padStart(12)} ${n.symbol}`
  if (n.usdc) {
    const usdc = await client.readContract({ address: n.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [me] })
    line += `   ${formatUnits(usdc, 6).padStart(10)} USDC`
  }
  console.log(line)
}

async function gasMoney(label, key, provider, address) {
  if (!address) return
  const client = publicClient(key)
  const [balance, reserves, debt] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: provider, abi: PAYABLE_ABI, functionName: 'reserves', args: [address] }),
    client.readContract({ address: provider, abi: PAYABLE_ABI, functionName: 'debt', args: [address] }),
  ])
  const flag = debt > 0n ? '  <-- IN DEBT: it will not run until this is paid' : ''
  console.log(
    `${label.padEnd(34)} balance ${formatEther(balance).slice(0, 10).padStart(10)}  reserves ${formatEther(reserves).slice(0, 10).padStart(10)}  debt ${formatEther(debt)}${flag}`,
  )
}

if (d.reactive?.till) {
  console.log('\nGas money held by Till contracts')
  await gasMoney('TillReactive (Lasna)', REACTIVE, SYSTEM, d.reactive.till)
  await gasMoney(`InvoiceBook (${network(HOME).name})`, HOME, network(HOME).callbackProxy, d.home?.invoiceBook)
  for (const key of PAY_CHAINS) {
    await gasMoney(`Collector (${network(key).name})`, key, network(key).callbackProxy, d.payChains?.[key]?.collector)
  }
} else {
  console.log('\nNothing deployed yet. Run `npm run deploy` once the deployer is funded.')
}
