// The demo wallet: a server-side account holding a little test USDC, so a visitor with no wallet can
// watch a real payment settle. Runs only on the server (see handler.ts); the key never reaches the
// browser.
//
// What keeps it from being drained or abused:
//   - It only pays invoices it created itself, for one fixed small amount, and those invoices pay
//     the demo wallet back, so the USDC goes round in a circle.
//   - An unpaid demo invoice is reused instead of creating another, new ones are spaced apart, and
//     there is a daily cap. Each new invoice costs Till a little REACT, and that is the real budget.
import { createWalletClient, http, parseEventLogs, parseUnits, type Address, type Hash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { STATUS, bookAbi, erc20Abi, tillAbi } from '../src/abi'
import { chain, client } from '../src/clients'
import { HOME, INVOICE_BOOK, NETWORKS, REACTIVE, TILL, payChain, type NetworkKey } from '../src/config'

export const DEMO_AMOUNT = parseUnits('0.10', 6)
const INVOICE_LIFETIME = 20 * 60 // seconds a demo invoice stays open
const REUSE_IF_LEFT = 5 * 60 // reuse an unpaid demo invoice with at least this long to run
const MIN_GAP = 20 // seconds between new demo invoices
const DAILY_CAP = BigInt(process.env.DEMO_DAILY_CAP ?? 40)

export class DemoError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function demoAccount() {
  const key = process.env.DEMO_PRIVATE_KEY
  if (!key) return null
  return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
}

function wallet(key: NetworkKey) {
  const account = demoAccount()
  if (!account) throw new DemoError(503, 'The demo wallet is not set up on this deployment.')
  return createWalletClient({ account, chain: chain(key), transport: http(NETWORKS[key].rpc) })
}

const now = () => Math.floor(Date.now() / 1000)
const home = () => client(HOME)

async function invoice(id: Hex) {
  return home().readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'getInvoice', args: [id] })
}

/** Reactive's system contract, which bills TillReactive for every reactive transaction. */
const SYSTEM: Address = '0x8888888888888888888888888888888888888888'
const debtAbi = [{ type: 'function', name: 'debt', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
/** One demo costs TillReactive about 0.05 REACT (two reactive transactions); keep a few in hand. */
const MIN_REACTIVE_GAS = parseUnits(process.env.DEMO_MIN_REACTIVE_GAS ?? '0.2', 18)

/**
 * Refuses to start a demo that could not finish. If TillReactive is low on gas money or in debt,
 * Reactive stops delivering its events, and the invoice would wait for a PAID that never comes.
 */
async function ensureReactiveFunded() {
  const reactive = client(REACTIVE)
  const [balance, debt] = await Promise.all([
    reactive.getBalance({ address: TILL }),
    reactive.readContract({ address: SYSTEM, abi: debtAbi, functionName: 'debt', args: [TILL] }),
  ]).catch(() => [MIN_REACTIVE_GAS, 0n] as const) // if Lasna's RPC is slow, don't block the demo on it
  if (debt > 0n || balance < MIN_REACTIVE_GAS) {
    throw new DemoError(503, "The live demo is paused while its testnet gas is topped up. Every past invoice is still on the tape, with all six transactions linked.")
  }
}

/**
 * What the browser needs to decide whether to offer the demo. It reads no chain, so it answers at
 * once: the home page waits on this before it can show the last sale.
 */
export async function demoInfo() {
  const account = demoAccount()
  if (!account) return { enabled: false as const }
  return { enabled: true as const, address: account.address, amount: DEMO_AMOUNT.toString() }
}

/** Returns an unpaid demo invoice if there is one with time left, otherwise creates a new one. */
export async function createDemoInvoice(): Promise<{ id: Hex; reused: boolean }> {
  const account = demoAccount()
  if (!account) throw new DemoError(503, 'The demo wallet is not set up on this deployment.')
  const me = account.address

  const count = await home().readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoiceCountOf', args: [me] })
  if (count > 0n) {
    const [lastId] = await home().readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoicesOf', args: [me, count - 1n, 1n] })
    const last = await invoice(lastId)
    if (last.status === STATUS.Open && last.received === 0n && last.expiresAt - now() > REUSE_IF_LEFT) {
      return { id: lastId, reused: true }
    }
    if (now() - last.createdAt < MIN_GAP) {
      throw new DemoError(429, 'Another demo just started. Try again in a few seconds.')
    }
    if (count >= DAILY_CAP) {
      const [capId] = await home().readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoicesOf', args: [me, count - DAILY_CAP, 1n] })
      if (now() - (await invoice(capId)).createdAt < 86_400) {
        throw new DemoError(429, "Today's demo budget is used up. You can still open a settled invoice and follow every transaction.")
      }
    }
  }

  await ensureReactiveFunded()
  const hash = await wallet(HOME).writeContract({
    address: INVOICE_BOOK, abi: bookAbi, functionName: 'createInvoice',
    args: [me, DEMO_AMOUNT, BigInt(now() + INVOICE_LIFETIME), 'Till live demo'],
  })
  const receipt = await home().waitForTransactionReceipt({ hash, timeout: 60_000 })
  const created = parseEventLogs({ abi: bookAbi, logs: receipt.logs, eventName: 'InvoiceCreated' })[0]
  if (receipt.status !== 'success' || !created) throw new DemoError(502, 'Creating the demo invoice failed. Try again.')
  return { id: created.args.id, reused: false }
}

const paying = new Set<string>()

/** Sends the demo amount of test USDC to a demo invoice's deposit address, as any payer would. */
export async function payDemoInvoice(id: Hex, networkKey: NetworkKey): Promise<{ tx: Hash; network: NetworkKey }> {
  const account = demoAccount()
  if (!account) throw new DemoError(503, 'The demo wallet is not set up on this deployment.')
  const { network, usdc } = payChain(networkKey)

  const inv = await invoice(id)
  if (inv.status === STATUS.None) throw new DemoError(404, 'No such invoice.')
  if (inv.seller.toLowerCase() !== account.address.toLowerCase() || inv.amount !== DEMO_AMOUNT) {
    throw new DemoError(403, 'The demo wallet only pays its own demo invoices.')
  }
  if (inv.status !== STATUS.Open || inv.received > 0n) throw new DemoError(409, 'This invoice is already paid.')
  if (inv.expiresAt <= now()) throw new DemoError(409, 'This invoice has expired. Start a new demo.')

  // Everything else the payment needs, fetched side by side so the visitor is not kept waiting:
  // the checks, plus the nonce and fees that the wallet would otherwise look up one at a time.
  const pay = client(networkKey)
  const [watch, alreadyThere, balance, nonce, fees] = await Promise.all([
    client(REACTIVE).readContract({ address: TILL, abi: tillAbi, functionName: 'watches', args: [inv.depositAddress] }),
    pay.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [inv.depositAddress as Address] }),
    pay.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    pay.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    pay.estimateFeesPerGas(),
  ])
  // Paying before Reactive has subscribed would send money nobody is watching for.
  if (!watch[6]) throw new DemoError(409, 'Reactive is still setting up this invoice. Try again in a moment.')
  await ensureReactiveFunded()
  if (alreadyThere > 0n || paying.has(id)) throw new DemoError(409, 'A payment for this invoice is already on its way.')
  if (balance < DEMO_AMOUNT) {
    throw new DemoError(503, `The demo wallet is out of test USDC on ${network.name}. Try another chain.`)
  }

  paying.add(id)
  try {
    const tx = await wallet(networkKey).writeContract({
      address: usdc, abi: erc20Abi, functionName: 'transfer', args: [inv.depositAddress, DEMO_AMOUNT],
      // A USDC transfer to a fresh address uses about 62,000 gas. A fixed limit saves an estimate call.
      gas: 120_000n,
      nonce,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    })
    return { tx, network: networkKey }
  } finally {
    setTimeout(() => paying.delete(id), 30_000)
  }
}
