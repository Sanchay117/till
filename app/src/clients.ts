import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem'
import { NETWORKS, type NetworkKey } from './config'

const chains = new Map<NetworkKey, Chain>()
const clients = new Map<NetworkKey, PublicClient>()

export function chain(key: NetworkKey): Chain {
  let found = chains.get(key)
  if (!found) {
    const n = NETWORKS[key]
    found = defineChain({
      id: n.id,
      name: n.name,
      nativeCurrency: { name: 'Ether', symbol: key === 'lasna' ? 'lREACT' : 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [n.rpc] } },
      blockExplorers: { default: { name: 'Explorer', url: n.explorer } },
    })
    chains.set(key, found)
  }
  return found
}

/** One read-only client per chain, shared by the whole app. */
export function client(key: NetworkKey): PublicClient {
  let found = clients.get(key)
  if (!found) {
    found = createPublicClient({ chain: chain(key), transport: http(NETWORKS[key].rpc, { retryCount: 2, timeout: 15_000 }) })
    clients.set(key, found)
  }
  return found
}
