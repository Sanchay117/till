// Chains and addresses. Used by the browser and by the demo functions in /api, so it must not touch
// `window`, `document` or `process`.
import type { Address } from 'viem'
import generated from './generated/deployment.json'

export type NetworkKey = 'lasna' | 'baseSepolia' | 'unichainSepolia' | 'sepolia'

export interface Network {
  key: NetworkKey
  id: number
  name: string
  rpc: string
  explorer: string
  /** Seconds between blocks, roughly. Only used to explain timings. */
  blockTime: number
}

const overrides = (generated.rpc ?? {}) as Partial<Record<NetworkKey, string>>

export const IS_LOCAL = generated.name === 'local'

export const NETWORKS: Record<NetworkKey, Network> = {
  lasna: {
    key: 'lasna',
    id: 5318007,
    name: 'Reactive Lasna',
    rpc: overrides.lasna ?? 'https://lasna-rpc.rnk.dev/',
    explorer: 'https://lasna.reactscan.net',
    blockTime: 1,
  },
  baseSepolia: {
    key: 'baseSepolia',
    id: 84532,
    name: 'Base Sepolia',
    rpc: overrides.baseSepolia ?? 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    blockTime: 0.2,
  },
  unichainSepolia: {
    key: 'unichainSepolia',
    id: 1301,
    name: 'Unichain Sepolia',
    rpc: overrides.unichainSepolia ?? 'https://sepolia.unichain.org',
    explorer: 'https://sepolia.uniscan.xyz',
    blockTime: 1,
  },
  sepolia: {
    key: 'sepolia',
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpc: overrides.sepolia ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    blockTime: 12,
  },
}

interface PayChain {
  chainId: number
  usdc: Address
  collector: Address
}

const d = generated.deployment as {
  reactive: { till: Address }
  factory: Address
  home: { network: NetworkKey; invoiceBook: Address }
  payChains: Partial<Record<NetworkKey, PayChain>>
}

export const REACTIVE: NetworkKey = 'lasna'
export const HOME: NetworkKey = d.home.network
export const TILL = d.reactive.till
export const INVOICE_BOOK = d.home.invoiceBook
export const FACTORY = d.factory

/** Chains Till accepts payment on, in the order the reactive contract was told about them. */
export const PAY_CHAINS = (Object.keys(d.payChains) as NetworkKey[]).map((key) => ({
  network: NETWORKS[key],
  usdc: d.payChains[key]!.usdc,
  collector: d.payChains[key]!.collector,
}))

export function payChain(key: NetworkKey) {
  const found = PAY_CHAINS.find((p) => p.network.key === key)
  if (!found) throw new Error(`Till does not accept payment on ${key}`)
  return found
}

export function networkById(id: number | bigint): Network | undefined {
  return Object.values(NETWORKS).find((n) => n.id === Number(id))
}

export const USDC_DECIMALS = 6

/** On the local devnet there is no explorer, so links are hidden. */
export function txUrl(key: NetworkKey, hash: string): string | undefined {
  return IS_LOCAL ? undefined : `${NETWORKS[key].explorer}/tx/${hash}`
}

export function addressUrl(key: NetworkKey, address: string): string | undefined {
  return IS_LOCAL ? undefined : `${NETWORKS[key].explorer}/address/${address}`
}
