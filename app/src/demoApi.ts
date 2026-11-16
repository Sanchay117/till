// Browser side of the demo wallet. The wallet itself lives in /api; see server/demo.ts.
import type { Address, Hash, Hex } from 'viem'
import type { NetworkKey } from './config'

export type DemoInfo =
  | { enabled: false }
  | { enabled: true; address: Address; amount: string; chains: { key: NetworkKey; name: string; funded: boolean }[] }

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
