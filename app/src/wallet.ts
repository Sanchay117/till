// The seller's own browser wallet. Only needed to create or cancel an invoice.
import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem'
import { chain } from './clients'
import { HOME, NETWORKS, type NetworkKey } from './config'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export const hasWallet = () => Boolean(window.ethereum)

/** Asks the wallet to connect. Throws if the person declines. */
export async function connect(): Promise<Address> {
  const accounts = await window.ethereum!.request({ method: 'eth_requestAccounts' })
  return accounts[0]
}

/** The already-connected account, without prompting. */
export async function connectedAccount(): Promise<Address | null> {
  if (!window.ethereum) return null
  const accounts = await window.ethereum.request({ method: 'eth_accounts' }).catch(() => [] as Address[])
  return accounts[0] ?? null
}

export async function ensureChain(key: NetworkKey = HOME) {
  const n = NETWORKS[key]
  const chainId = `0x${n.id.toString(16)}`
  try {
    await window.ethereum!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (error) {
    // 4902: the wallet does not know this chain yet.
    if ((error as { code?: number }).code !== 4902) throw error
    await window.ethereum!.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: n.name, rpcUrls: [n.rpc], blockExplorerUrls: [n.explorer], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }],
    })
  }
}

export function walletFor(account: Address, key: NetworkKey = HOME) {
  return createWalletClient({ account, chain: chain(key), transport: custom(window.ethereum!) })
}

/** A short, human message for a failed wallet action. */
export function walletError(error: unknown): string {
  const e = error as { code?: number; shortMessage?: string; message?: string }
  if (e.code === 4001 || /rejected|denied/i.test(e.message ?? '')) return 'You cancelled the request in your wallet.'
  return e.shortMessage ?? e.message ?? 'Something went wrong in the wallet.'
}
