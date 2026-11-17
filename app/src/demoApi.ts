// Browser side of the demo wallet. The wallet itself lives in /api; see server/demo.ts.
import type { Address, Hash, Hex } from 'viem'
import { erc20Abi } from './abi'
import { client } from './clients'
import { PAY_CHAINS, type NetworkKey } from './config'

export type DemoInfo = { enabled: false } | { enabled: true; address: Address; amount: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new Error('Could not reach the demo service. Check your connection and try again.')
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? 'The demo service is not available right now.')
  return body
}

let info: Promise<DemoInfo> | undefined

/** Cached for the page's lifetime. Resolves to `{ enabled: false }` if the service is missing. */
export function getDemoInfo(): Promise<DemoInfo> {
  info ??= call<DemoInfo>('/api/demo/info').catch(() => ({ enabled: false }) as DemoInfo)
  return info
}

/** The pay chains where the demo wallet holds enough test USDC to pay a demo invoice. */
export async function demoChains(info: Extract<DemoInfo, { enabled: true }>): Promise<NetworkKey[]> {
  const funded = await Promise.all(
    PAY_CHAINS.map(({ network, usdc }) =>
      client(network.key)
        .readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [info.address] })
        .then((balance) => balance >= BigInt(info.amount))
        .catch(() => false),
    ),
  )
  return PAY_CHAINS.filter((_, i) => funded[i]).map((p) => p.network.key)
}

export function startDemo(): Promise<{ id: Hex; reused: boolean }> {
  return call('/api/demo/invoice', { method: 'POST' })
}

export function payDemo(id: Hex, network: NetworkKey): Promise<{ tx: Hash; network: NetworkKey }> {
  return call('/api/demo/pay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, network }),
  })
}
