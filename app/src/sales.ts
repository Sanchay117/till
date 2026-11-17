// Live numbers for the home page, all read straight from the chains. Nothing here is a placeholder.
import { useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import { STATUS, bookAbi } from './abi'
import { client } from './clients'
import { HOME, INVOICE_BOOK, REACTIVE, networkById, type NetworkKey } from './config'

export interface Sale {
  id: Hex
  amount: bigint
  paidAt: number
  paidOn?: NetworkKey
  /** Payment landing to invoice marked paid, by block timestamps. Undefined if it could not be read. */
  seconds?: number
}

/**
 * The most recent paid invoices created by `seller`, newest first.
 * `lookBack` is how many of the seller's latest invoices to read; fewer is faster.
 */
export async function lastSales(seller: Address, limit: number, lookBack: number): Promise<Sale[]> {
  const home = client(HOME)
  const count = await home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoiceCountOf', args: [seller] })
  if (count === 0n) return []
  const take = count > BigInt(lookBack) ? BigInt(lookBack) : count
  const ids = await home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoicesOf', args: [seller, count - take, take] })
  const invoices = await Promise.all(
    ids.map((id) => home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'getInvoice', args: [id] })),
  )

  const paid = ids
    .map((id, i) => ({ id, invoice: invoices[i] }))
    .filter(({ invoice }) => invoice.status === STATUS.Paid)
    .sort((a, b) => b.invoice.paidAt - a.invoice.paidAt)
    .slice(0, limit)

  return Promise.all(
    paid.map(async ({ id, invoice }): Promise<Sale> => {
      const network = networkById(invoice.paidOnChain)
      const sale: Sale = { id, amount: invoice.received, paidAt: invoice.paidAt, paidOn: network?.key }
      if (network) {
        // When did the payment itself land? That is where the clock starts.
        try {
          const pay = client(network.key)
          const receipt = await pay.getTransactionReceipt({ hash: invoice.payTxHash })
          const block = await pay.getBlock({ blockNumber: receipt.blockNumber })
          sale.seconds = Math.max(0, invoice.paidAt - Number(block.timestamp))
        } catch {
          // Left undefined: the tape shows a dash rather than a guess.
        }
      }
      return sale
    }),
  )
}

/** Reactive's latest block number, refreshed about once a block. Null until the first answer. */
export function useReactiveBlock(): bigint | null {
  const [block, setBlock] = useState<bigint | null>(null)
  useEffect(() => {
    let stopped = false
    let timer = 0
    async function tick() {
      try {
        const next = await client(REACTIVE).getBlockNumber({ cacheTime: 0 })
        if (!stopped) setBlock(next)
      } catch {
        // Keep the last number on screen.
      }
      if (!stopped) timer = window.setTimeout(tick, 1000)
    }
    void tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [])
  return block
}

/** How many invoices the InvoiceBook has ever recorded. */
export function useInvoiceCount(): bigint | null {
  const [count, setCount] = useState<bigint | null>(null)
  useEffect(() => {
    let stopped = false
    client(HOME)
      .readContract({ address: INVOICE_BOOK, abi: [{ type: 'function', name: 'invoiceCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'invoiceCount' })
      .then((n) => !stopped && setCount(n))
      .catch(() => undefined)
    return () => {
      stopped = true
    }
  }, [])
  return count
}
