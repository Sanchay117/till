import { useCallback, useEffect, useRef, useState } from 'react'
import type { Hash, Hex } from 'viem'
import type { NetworkKey } from './config'
import { invoiceLoader, isSettled, type InvoiceView } from './invoice'

const POLL_MS = 500
/** Straight after creation a lagging RPC node may not know the invoice yet, so "not found" is only
 *  believed after it has been the answer this many times in a row. */
const NOT_FOUND_AFTER = 8

/** `undefined` while loading, `null` when there is no such invoice. Polls until nothing can change. */
export function useInvoice(id: Hex) {
  const [view, setView] = useState<InvoiceView | null | undefined>(undefined)
  const [offline, setOffline] = useState(false)
  const loader = useRef<ReturnType<typeof invoiceLoader> | null>(null)

  useEffect(() => {
    const current = invoiceLoader(id)
    loader.current = current
    setView(undefined)
    let stopped = false
    let stateTimer = 0
    let stepsTimer = 0
    let misses = 0
    const done = () => {
      const v = current.view()
      return Boolean(v && isSettled(v))
    }

    // Two loops, so the slow one never holds up the fast one.
    // This one makes the two reads that decide what the page says: is it paid, is Till watching.
    async function pollState() {
      try {
        const found = await current.loadState()
        if (stopped) return
        setOffline(false)
        if (found) {
          misses = 0
          setView(current.view())
        } else if (++misses >= NOT_FOUND_AFTER) {
          setView(null)
        }
      } catch {
        if (!stopped) setOffline(true)
      }
      if (!stopped && !done()) stateTimer = window.setTimeout(pollState, POLL_MS)
    }

    // This one finds the transaction behind each step, for the links and timings.
    async function pollSteps() {
      await current.loadSteps().catch(() => undefined)
      if (stopped) return
      const next = current.view()
      if (next) setView(next)
      if (!done()) stepsTimer = window.setTimeout(pollSteps, POLL_MS)
    }

    void pollState()
    void pollSteps()
    return () => {
      stopped = true
      window.clearTimeout(stateTimer)
      window.clearTimeout(stepsTimer)
    }
  }, [id])

  const hintPayment = useCallback((network: NetworkKey, tx: Hash) => {
    loader.current?.hintPayment(network, tx)
    setView(loader.current?.view() ?? undefined)
  }, [])
  return { view, offline, hintPayment }
}

/** Re-render once a second, for countdowns and "n seconds ago". */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
