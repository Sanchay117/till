// Shared helpers for Till's deploy and test scripts.
// Run scripts with:  node --env-file=.env scripts/<name>.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Reactive's system contract, the same address on Reactive Mainnet and Lasna. */
export const SYSTEM = '0x8888888888888888888888888888888888888888'
/** The deterministic CREATE2 deployer present on most EVM chains. */
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C'
/** Fixed salt, so the ForwarderFactory lands on the same address on every chain. */
export const FACTORY_SALT = '0x54696c6c2e466f72776172646572466163746f72792e76310000000000000000' // "Till.ForwarderFactory.v1"

// Callback proxies: https://dev.reactive.network/origins-and-destinations
// USDC: Circle's testnet deployments.
const NETWORKS = {
  lasna: {
    id: 5318007,
    name: 'Reactive Lasna',
    symbol: 'lREACT',
    rpcEnv: 'LASNA_RPC',
    rpc: 'https://lasna-rpc.rnk.dev/',
    explorer: 'https://lasna.reactscan.net',
    legacyTx: true,
  },
  baseSepolia: {
    id: 84532,
    name: 'Base Sepolia',
    symbol: 'ETH',
    rpcEnv: 'BASE_SEPOLIA_RPC',
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    callbackProxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  unichainSepolia: {
    id: 1301,
    name: 'Unichain Sepolia',
    symbol: 'ETH',
    rpcEnv: 'UNICHAIN_SEPOLIA_RPC',
    rpc: 'https://sepolia.unichain.org',
    explorer: 'https://sepolia.uniscan.xyz',
    callbackProxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
    usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
  },
  sepolia: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    symbol: 'ETH',
    rpcEnv: 'SEPOLIA_RPC',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    callbackProxy: '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
}

export const REACTIVE = 'lasna'
export const HOME = process.env.HOME_CHAIN || 'baseSepolia'
export const PAY_CHAINS = (process.env.PAY_CHAINS || 'baseSepolia,unichainSepolia,sepolia')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function network(key) {
  const n = NETWORKS[key]
  if (!n) throw new Error(`Unknown network "${key}". Known: ${Object.keys(NETWORKS).join(', ')}`)
  return { key, ...n, rpc: process.env[n.rpcEnv] || n.rpc }
}

export function networkById(id) {
  const key = Object.keys(NETWORKS).find((k) => NETWORKS[k].id === Number(id))
  if (!key) throw new Error(`Unknown chain id ${id}`)
  return network(key)
}

function viemChain(n) {
  return defineChain({
    id: n.id,
    name: n.name,
    nativeCurrency: { name: n.symbol, symbol: n.symbol, decimals: 18 },
    rpcUrls: { default: { http: [n.rpc] } },
  })
}

export function publicClient(key) {
  const n = network(key)
  return createPublicClient({ chain: viemChain(n), transport: http(n.rpc, { retryCount: 3 }), pollingInterval: 250 })
}

export function account() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY
  if (!pk) {
    throw new Error('DEPLOYER_PRIVATE_KEY is not set. Run `npm run wallet` first, then fund the address it prints.')
  }
  return privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
}

export function walletClient(key) {
  const n = network(key)
  return createWalletClient({ account: account(), chain: viemChain(n), transport: http(n.rpc, { retryCount: 3 }) })
}

/** Extra transaction fields a chain needs. Lasna is sent legacy-style with the node's gas price. */
export async function txOverrides(key) {
  const n = network(key)
  if (!n.legacyTx) return {}
  return { type: 'legacy', gasPrice: await publicClient(key).getGasPrice() }
}

/** ABI and creation bytecode from Foundry's build output. Run `npm run build` first. */
export function artifact(name, file = name) {
  const path = join(ROOT, 'out', `${file}.sol`, `${name}.json`)
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run \`npm run build\` first.`)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return { abi: json.abi, bytecode: json.bytecode.object }
}

const DEPLOYMENTS = join(ROOT, 'deployments', `${process.env.DEPLOYMENT || 'testnet'}.json`)

export function loadDeployments() {
  if (!existsSync(DEPLOYMENTS)) return { reactive: {}, factory: null, home: {}, payChains: {} }
  return JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'))
}

export function saveDeployments(d) {
  mkdirSync(dirname(DEPLOYMENTS), { recursive: true })
  writeFileSync(DEPLOYMENTS, JSON.stringify(d, null, 2) + '\n')
}

export const txUrl = (key, hash) => `${network(key).explorer}/tx/${hash}`
export const addressUrl = (key, address) => `${network(key).explorer}/address/${address}`

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll `fn` until it returns something truthy, or give up after `timeoutMs`. */
export async function waitFor(fn, { timeoutMs = 120_000, everyMs = 250, what = 'condition' } = {}) {
  const start = Date.now()
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${what}`)
    await sleep(everyMs)
  }
}

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'value' },
    ],
  },
]

/** `reserves` and `debt` exist on both the system contract and every callback proxy. */
export const PAYABLE_ABI = [
  { type: 'function', name: 'reserves', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'debt', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]
