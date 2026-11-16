// Reads one invoice and the six steps of its life from the three chains involved.
//
// Nothing here scans for events. The contracts store the block each step happened in, so every
// lookup asks for logs in exactly one block. That matters on public RPCs, which cap log ranges
// (Base Sepolia makes five blocks a second).
import { toHex, type Address, type Hash, type Hex } from 'viem'
import { STATUS, bookAbi, collectorAbi, tillAbi } from './abi'
import { client } from './clients'
import { HOME, INVOICE_BOOK, REACTIVE, TILL, networkById, payChain, type NetworkKey } from './config'

export type StepKey = 'created' | 'watching' | 'payment' | 'reacted' | 'marked' | 'swept'

export interface Step {
  network?: NetworkKey
  tx?: Hash
  /** Block timestamp, unix seconds. Missing while a transaction is known but not yet in a block. */
  time?: number
}

export interface Invoice {
  seller: Address
  createdAt: number
  expiresAt: number
  payTo: Address
  paidAt: number
  status: number
  depositAddress: Address
  createdBlock: bigint
  amount: bigint
  received: bigint
  payer: Address
  paidOnChain: bigint
  paidBlock: bigint
  payTxHash: Hex
  memo: string
}

export type InvoiceState = 'open' | 'partly' | 'paid' | 'cancelled' | 'expired'

export interface InvoiceView {
  id: Hex
  invoice: Invoice
  state: InvoiceState
  /** Is Till watching the deposit address right now? */
  watching: boolean
  steps: Record<StepKey, Step>
  /** Payment landing to invoice marked paid, by block timestamps (whole seconds). */
  secondsToPaid?: number
}

/** How far past the payment's block to look for the sweep callback. */
const SWEEP_WINDOW = 2000n

export function invoiceLoader(id: Hex) {
  const steps: Record<StepKey, Step> = {
    created: { network: HOME },
    watching: { network: REACTIVE },
    payment: {},
    reacted: { network: REACTIVE },
    marked: { network: HOME },
    swept: {},
  }
  let inv: Invoice | undefined
  let watching = false
  let watchedBlock = 0n
  let seenBlock = 0n
  let reactedBlock = 0n
  let paymentBlock: bigint | undefined

  const home = client(HOME)
  const reactive = client(REACTIVE)
  const blockTime = async (key: NetworkKey, blockNumber: bigint) =>
    Number((await client(key).getBlock({ blockNumber })).timestamp)

  async function findCreated(invoice: Invoice) {
    const logs = await home.getContractEvents({
      address: INVOICE_BOOK, abi: bookAbi, eventName: 'InvoiceCreated', args: { id },
      fromBlock: invoice.createdBlock, toBlock: invoice.createdBlock,
    })
    if (logs[0]) steps.created = { network: HOME, tx: logs[0].transactionHash, time: invoice.createdAt }
  }

  async function findMarked(invoice: Invoice) {
    const logs = await home.getContractEvents({
      address: INVOICE_BOOK, abi: bookAbi, eventName: 'InvoicePaid', args: { id },
      fromBlock: invoice.paidBlock, toBlock: invoice.paidBlock,
    })
    if (logs[0]) steps.marked = { network: HOME, tx: logs[0].transactionHash, time: invoice.paidAt }
  }

  async function findWatching(block: bigint) {
    const [logs, time] = await Promise.all([
      reactive.getContractEvents({
        address: TILL, abi: tillAbi, eventName: 'Watching', args: { invoiceId: id }, fromBlock: block, toBlock: block,
      }),
      blockTime(REACTIVE, block),
    ])
    if (logs[0]) steps.watching = { network: REACTIVE, tx: logs[0].transactionHash, time }
  }

  async function findPayment(network: NetworkKey, tx: Hash) {
    const receipt = await client(network).getTransactionReceipt({ hash: tx })
    const time = await blockTime(network, receipt.blockNumber)
    paymentBlock = receipt.blockNumber
    steps.payment = { network, tx, time }
  }

  async function findReacted(block: bigint) {
    const [logs, time] = await Promise.all([
      reactive.getContractEvents({
        address: TILL, abi: tillAbi, eventName: 'PaymentSeen', args: { invoiceId: id }, fromBlock: block, toBlock: block,
      }),
      blockTime(REACTIVE, block),
    ])
    const log = logs.at(-1)
    if (!log) return
    reactedBlock = block
    steps.reacted = { network: REACTIVE, tx: log.transactionHash, time }

    // The reactive contract recorded which chain the money landed on and in which transaction.
    const origin = networkById(log.args.chainId!)
    const tx = toHex(log.args.originTxHash!, { size: 32 })
    if (origin && (steps.payment.tx !== tx || steps.payment.time === undefined)) {
      steps.swept = {}
      await findPayment(origin.key, tx)
    }
  }

  async function findSwept() {
    const network = steps.payment.network
    if (!network || paymentBlock === undefined) return
    const pay = client(network)
    const latest = await pay.getBlockNumber()
    const toBlock = latest < paymentBlock + SWEEP_WINDOW ? latest : paymentBlock + SWEEP_WINDOW
    if (toBlock < paymentBlock) return
    const logs = await pay.getContractEvents({
      address: payChain(network).collector, abi: collectorAbi, eventName: 'Swept', args: { invoiceId: id },
      fromBlock: paymentBlock, toBlock,
    })
    const log = logs[0]
    if (log) steps.swept = { network, tx: log.transactionHash, time: await blockTime(network, log.blockNumber) }
  }

  function view(): InvoiceView | null {
    if (!inv) return null
    let state: InvoiceState = 'open'
    if (inv.status === STATUS.Paid) state = 'paid'
    else if (inv.status === STATUS.Cancelled) state = 'cancelled'
    else if (Date.now() / 1000 > inv.expiresAt) state = 'expired'
    else if (inv.received > 0n) state = 'partly'

    const secondsToPaid =
      state === 'paid' && steps.payment.time !== undefined ? Math.max(0, inv.paidAt - steps.payment.time) : undefined
    return { id, invoice: inv, state, watching, steps: { ...steps }, secondsToPaid }
  }

  return {
    view,

    /** A demo payment's hash is known before Reactive has seen it. Show it straight away. */
    hintPayment(network: NetworkKey, tx: Hash) {
      if (!steps.payment.tx) steps.payment = { network, tx }
    },

    /**
     * The fast part: two reads that say whether the invoice is paid and whether Till is watching.
     * Returns false when no such invoice exists. Safe to call again and again.
     */
    async loadState(): Promise<boolean> {
      const readWatch = (depositAddress: Address) =>
        reactive.readContract({ address: TILL, abi: tillAbi, functionName: 'watches', args: [depositAddress] }).catch(() => null)

      // The deposit address is only known once the invoice has been read, so the very first call
      // reads the two one after the other. Every later call reads them side by side.
      let [nextInvoice, watch] = await Promise.all([
        home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'getInvoice', args: [id] }) as Promise<Invoice>,
        inv ? readWatch(inv.depositAddress) : Promise.resolve(null),
      ])
      if (nextInvoice.status === STATUS.None) return Boolean(inv)
      if (!inv) watch = await readWatch(nextInvoice.depositAddress)

      // Public RPCs are load-balanced, so a later read can come from a node that is a block behind.
      // An invoice never goes from paid back to open, so never show that.
      const wentBackwards = inv?.status === STATUS.Paid && nextInvoice.status !== STATUS.Paid
      if (!wentBackwards) inv = nextInvoice

      if (watch) {
        watching = watch[6]
        if (watch[7] > watchedBlock) watchedBlock = watch[7]
        if (watch[8] > seenBlock) seenBlock = watch[8]
      }
      return true
    },

    /**
     * The slower part: the transaction behind each step, for the links and timings. Lookups run in
     * parallel and any of them may fail on a lagging node. The next poll simply tries again.
     */
    async loadSteps(): Promise<void> {
      if (!inv) return
      const jobs: Promise<unknown>[] = []
      if (!steps.created.tx) jobs.push(findCreated(inv))
      if (inv.paidBlock > 0n && !steps.marked.tx) jobs.push(findMarked(inv))
      if (watchedBlock > 0n && !steps.watching.tx) jobs.push(findWatching(watchedBlock))
      if (seenBlock > 0n && seenBlock !== reactedBlock) {
        jobs.push(findReacted(seenBlock))
      } else if (steps.payment.tx && steps.payment.network && steps.payment.time === undefined) {
        jobs.push(findPayment(steps.payment.network, steps.payment.tx))
      }
      await Promise.allSettled(jobs)
      if (steps.payment.time !== undefined && !steps.swept.tx) await findSwept().catch(() => undefined)
    },
  }
}

/** True once there is nothing left on the page that could still change. */
export function isSettled(view: InvoiceView): boolean {
  if (view.state === 'cancelled') return true
  return view.state === 'paid' && Boolean(view.steps.marked.tx && view.steps.swept.tx && view.steps.reacted.tx)
}
