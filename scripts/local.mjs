// A local Till devnet: three Anvil chains wearing the real chain ids, plus a small relayer that plays
// Reactive Network. No faucets, no testnet coins, and the same deploy script as the real thing.
//
//   npm run local        start it (leave it running)
//   npm run e2e:local    in another terminal: create an invoice, pay it on the other chain, watch it settle
//
// What is faked, and how:
//   - Reactive's system contract: test/mocks/MockSystem.sol is placed at 0x8888…8888 on the "Lasna" chain.
//     It keeps a real subscription registry and emits the same CallbackRequest event as the live one.
//   - Callback proxies and USDC: mocks are placed at the REAL testnet addresses, so nothing in the
//     deploy config changes between local and live.
//   - The network itself: the loop at the bottom reads logs from the pay chains, calls react() as the
//     system contract when a subscription matches, and delivers each requested callback.
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createTestClient, decodeAbiParameters, http, parseAbiItem, parseEther, parseUnits } from 'viem'
import {
  PAY_CHAINS, REACTIVE, ROOT, SYSTEM, account, artifact, loadDeployments, network, networkById, publicClient, sleep,
  waitFor, walletClient,
} from './lib.mjs'

if (process.env.DEPLOYMENT !== 'local') {
  throw new Error('Run this through `npm run local`, which loads devnet.env. Refusing to touch a real deployment.')
}

const CHAIN_KEYS = [REACTIVE, ...PAY_CHAINS]
const me = account().address
const children = []
const stop = () => children.forEach((c) => c.kill())
process.on('SIGINT', () => { stop(); process.exit(0) })
process.on('exit', stop)

// ── 1. Three Anvil chains with the real chain ids ──
const anvilBin = join(ROOT, 'node_modules', '@foundry-rs', 'anvil', 'bin.mjs')
for (const key of CHAIN_KEYS) {
  const n = network(key)
  const port = new URL(n.rpc).port
  const child = spawn(process.execPath, [anvilBin, '--port', port, '--chain-id', String(n.id), '--silent'], { stdio: 'inherit' })
  child.on('exit', (code) => { if (code) { console.error(`anvil for ${n.name} exited with ${code}`); process.exit(1) } })
  children.push(child)
}
for (const key of CHAIN_KEYS) {
  await waitFor(() => publicClient(key).getChainId(), { timeoutMs: 30_000, what: `anvil for ${network(key).name}` })
}

const test = (key) => createTestClient({ mode: 'anvil', transport: http(network(key).rpc) })
const runtime = (name, file) => {
  const path = join(ROOT, 'out', `${file ?? name}.sol`, `${name}.json`)
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run \`npm run build\` first.`)
  return artifact(name, file ?? name)
}
const deployedCode = async (name, file) => {
  const { readFileSync } = await import('node:fs')
  return JSON.parse(readFileSync(join(ROOT, 'out', `${file ?? name}.sol`, `${name}.json`), 'utf8')).deployedBytecode.object
}

// ── 2. Put the mocks where the real contracts live ──
await test(REACTIVE).setCode({ address: SYSTEM, bytecode: await deployedCode('MockSystem') })
await test(REACTIVE).impersonateAccount({ address: SYSTEM })
await test(REACTIVE).setBalance({ address: SYSTEM, value: parseEther('1000') })

const usdcAbi = runtime('MockUSDC', 'MockTokens').abi
for (const key of PAY_CHAINS) {
  const n = network(key)
  await test(key).setCode({ address: n.callbackProxy, bytecode: await deployedCode('MockProxy') })
  await test(key).setCode({ address: n.usdc, bytecode: await deployedCode('MockUSDC', 'MockTokens') })
  const hash = await walletClient(key).writeContract({ address: n.usdc, abi: usdcAbi, functionName: 'mint', args: [me, parseUnits('1000', 6)] })
  await publicClient(key).waitForTransactionReceipt({ hash })
}
console.log('Local chains are up:')
for (const key of CHAIN_KEYS) console.log(`  ${network(key).name.padEnd(18)} ${network(key).rpc}  (chain id ${network(key).id})`)

// ── 3. Deploy Till with the ordinary deploy script ──
rmSync(join(ROOT, 'deployments', 'local.json'), { force: true })
console.log('\nDeploying Till...\n')
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'deploy.mjs')], { stdio: 'inherit', env: process.env })
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`deploy exited with ${code}`))))
})
const d = loadDeployments()
const till = d.reactive.till

// ── 4. Play Reactive Network ──
const systemAbi = runtime('MockSystem').abi
const proxyAbi = runtime('MockProxy').abi
const tillAbi = runtime('TillReactive').abi
const callbackRequest = parseAbiItem(
  'event CallbackRequest(uint256 indexed chainId, address indexed sender, address indexed recipient, uint8 version, bytes configuration)',
)
const reactive = publicClient(REACTIVE)
const cursor = Object.fromEntries(await Promise.all(CHAIN_KEYS.map(async (k) => [k, await publicClient(k).getBlockNumber()])))

/** Deliver matching logs from a pay chain to TillReactive, as the system contract would. */
async function relayLogs(key) {
  const client = publicClient(key)
  const latest = await client.getBlockNumber()
  if (latest <= cursor[key]) return
  const logs = await client.getLogs({ fromBlock: cursor[key] + 1n, toBlock: latest })
  cursor[key] = latest
  for (const log of logs) {
    const record = {
      chainId: BigInt(network(key).id),
      contractAddress: log.address,
      topic0: BigInt(log.topics[0] ?? 0),
      topic1: BigInt(log.topics[1] ?? 0),
      topic2: BigInt(log.topics[2] ?? 0),
      topic3: BigInt(log.topics[3] ?? 0),
      data: log.data,
      blockNumber: log.blockNumber,
      opCode: BigInt(log.topics.length),
      blockHash: BigInt(log.blockHash),
      txHash: BigInt(log.transactionHash),
      logIndex: BigInt(log.logIndex),
    }
    const wanted = await reactive.readContract({ address: SYSTEM, abi: systemAbi, functionName: 'matches', args: [till, record] })
    if (!wanted) continue
    const hash = await walletClient(REACTIVE).writeContract({
      account: SYSTEM, address: till, abi: tillAbi, functionName: 'react', args: [record], gas: 900_000n,
    })
    const receipt = await reactive.waitForTransactionReceipt({ hash })
    console.log(`[reactive] react() for a log on ${network(key).name}: ${receipt.status}, ${receipt.gasUsed} gas`)
  }
}

/** Deliver the callbacks TillReactive asked for, through each chain's (mock) callback proxy. */
async function relayCallbacks() {
  const latest = await reactive.getBlockNumber()
  if (latest <= cursor[REACTIVE]) return
  const logs = await reactive.getLogs({ address: SYSTEM, event: callbackRequest, fromBlock: cursor[REACTIVE] + 1n, toBlock: latest })
  cursor[REACTIVE] = latest
  for (const log of logs) {
    const [config] = decodeAbiParameters(
      [{ type: 'tuple', components: [{ name: 'chainId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'gasLimit', type: 'uint64' }, { name: 'payload', type: 'bytes' }] }],
      log.args.configuration,
    )
    const dest = networkById(config.chainId)
    const hash = await walletClient(dest.key).writeContract({
      address: dest.callbackProxy, abi: proxyAbi, functionName: 'deliver',
      args: [config.recipient, config.payload, log.args.sender, config.gasLimit], gas: config.gasLimit + 200_000n,
    })
    const receipt = await publicClient(dest.key).waitForTransactionReceipt({ hash })
    console.log(`[reactive] callback delivered on ${dest.name}: ${receipt.status}`)
  }
}

console.log('\nLocal devnet ready. In another terminal:  npm run e2e:local')
console.log('Ctrl+C stops everything.\n')
for (;;) {
  try {
    for (const key of PAY_CHAINS) await relayLogs(key)
    await relayCallbacks()
  } catch (error) {
    console.error('[reactive] relay error:', error.shortMessage ?? error.message)
  }
  await sleep(150)
}
