import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from './config'

/** 100000n -> "0.10". Always two decimals at least, never more than six. */
export function usdc(amount: bigint): string {
  const [whole, fraction = ''] = formatUnits(amount, USDC_DECIMALS).split('.')
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0')
  return `${Number(whole).toLocaleString('en-US')}.${trimmed}`
}

/** "12.5" -> 12500000n. Returns null for anything that is not a positive amount. */
export function parseUsdc(text: string): bigint | null {
  const clean = text.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) return null
  const value = parseUnits(clean, USDC_DECIMALS)
  return value > 0n ? value : null
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const shortHash = (h: string) => `${h.slice(0, 10)}…`

export function clock(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function timeLeft(unixSeconds: number): string {
  const s = Math.floor(unixSeconds - Date.now() / 1000)
  if (s <= 0) return 'expired'
  if (s < 3600) return `${Math.ceil(s / 60)} min left`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h left`
  return `${Math.round(s / 86400)} days left`
}

/** Block timestamps are whole seconds, so "0" means "inside the same second". */
export function seconds(n: number): string {
  if (n <= 0) return 'under 1 s'
  return `${n} s`
}
