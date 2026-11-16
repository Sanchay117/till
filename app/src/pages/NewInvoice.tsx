import { useEffect, useState } from 'react'
import { isAddress, parseEventLogs, type Address, type Hex } from 'viem'
import { STATUS, bookAbi } from '../abi'
import { client } from '../clients'
import { HOME, INVOICE_BOOK, NETWORKS } from '../config'
import { parseUsdc, shortAddress, usdc } from '../format'
import { linkProps, navigate } from '../router'
import { connect, connectedAccount, ensureChain, hasWallet, walletError, walletFor } from '../wallet'

const LIFETIMES = [
  { label: '1 day', seconds: 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
]

export function NewInvoice() {
  const [account, setAccount] = useState<Address | null>(null)
  const [amount, setAmount] = useState('')
  const [payTo, setPayTo] = useState('')
  const [memo, setMemo] = useState('')
  const [lifetime, setLifetime] = useState(LIFETIMES[1].seconds)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void connectedAccount().then((a) => {
      setAccount(a)
      if (a) setPayTo((current) => current || a)
    })
  }, [])

  const amountUnits = parseUsdc(amount)
  const memoBytes = new TextEncoder().encode(memo).length
  const problem = !amountUnits
    ? 'Enter an amount, for example 250 or 12.50.'
    : !isAddress(payTo)
      ? 'Enter the wallet address the money should go to.'
      : memoBytes > 140
        ? 'The note is too long.'
        : ''

  async function onConnect() {
    setError('')
    try {
      const a = await connect()
      setAccount(a)
      setPayTo((current) => current || a)
    } catch (e) {
      setError(walletError(e))
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!account || problem || !amountUnits) return
    setError('')
    try {
      setBusy(`Switching your wallet to ${NETWORKS[HOME].name}…`)
      await ensureChain(HOME)
      setBusy('Confirm the invoice in your wallet…')
      const hash = await walletFor(account).writeContract({
        address: INVOICE_BOOK, abi: bookAbi, functionName: 'createInvoice',
        args: [payTo as Address, amountUnits, BigInt(Math.floor(Date.now() / 1000) + lifetime), memo.trim()],
      })
      setBusy('Adding it to the books…')
      const receipt = await client(HOME).waitForTransactionReceipt({ hash })
      const created = parseEventLogs({ abi: bookAbi, logs: receipt.logs, eventName: 'InvoiceCreated' })[0]
      if (receipt.status !== 'success' || !created) throw new Error('The transaction did not go through.')
      navigate(`/i/${created.args.id}`)
    } catch (e) {
      setError(walletError(e))
      setBusy('')
    }
  }

  return (
    <main className="page narrow">
      <div className="receipt">
        <header className="receipt-head">
          <span className="eyebrow">New invoice</span>
          <span className="muted">books on {NETWORKS[HOME].name}</span>
        </header>

        {!hasWallet() ? (
          <>
            <p>
              Creating an invoice takes one transaction on {NETWORKS[HOME].name}, so you need a browser wallet such as
              MetaMask with a little test ETH there.
            </p>
            <p className="muted">Your client will not need one. They can pay from any wallet or exchange.</p>
            <a className="button" {...linkProps('/')}>
              Watch the demo instead
            </a>
          </>
        ) : !account ? (
          <>
            <p>Connect the wallet that will own this invoice. Creating it is one transaction on {NETWORKS[HOME].name}.</p>
            <button type="button" className="button" onClick={onConnect}>
              Connect wallet
            </button>
            {error && <p className="error">{error}</p>}
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <label>
              <span>Amount</span>
              <div className="field with-unit">
                <input inputMode="decimal" placeholder="250.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                <span className="unit">USDC</span>
              </div>
            </label>
            <label>
              <span>Pay out to</span>
              <input className="mono" spellCheck={false} placeholder="0x…" value={payTo} onChange={(e) => setPayTo(e.target.value.trim())} />
              <small>
                The money can only ever go to this address. It can be a different wallet from the one you are connected
                with, such as a cold wallet.
              </small>
            </label>
            <label>
              <span>Note for the payer</span>
              <input placeholder="Logo design, March" value={memo} onChange={(e) => setMemo(e.target.value)} />
              <small>{memoBytes}/140. This is public.</small>
            </label>
            <fieldset>
              <legend>Stop waiting after</legend>
              <div className="row">
                {LIFETIMES.map((l) => (
                  <label key={l.seconds} className="choice">
                    <input type="radio" name="lifetime" checked={lifetime === l.seconds} onChange={() => setLifetime(l.seconds)} />
                    {l.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" className="button big" disabled={Boolean(busy) || Boolean(problem)}>
              {busy || 'Create invoice'}
            </button>
            {problem && amount && <p className="fine">{problem}</p>}
            {error && <p className="error">{error}</p>}
            <p className="fine">Connected as {shortAddress(account)}.</p>
          </form>
        )}
      </div>

      {account && <MyInvoices seller={account} />}
    </main>
  )
}

interface Row {
  id: Hex
  amount: bigint
  status: number
  memo: string
}

function MyInvoices({ seller }: { seller: Address }) {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const home = client(HOME)
      const count = await home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoiceCountOf', args: [seller] })
      const take = count > 10n ? 10n : count
      const ids = await home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'invoicesOf', args: [seller, count - take, take] })
      const invoices = await Promise.all(
        ids.map((id) => home.readContract({ address: INVOICE_BOOK, abi: bookAbi, functionName: 'getInvoice', args: [id] })),
      )
      if (!cancelled) {
        setRows(ids.map((id, i) => ({ id, amount: invoices[i].amount, status: invoices[i].status, memo: invoices[i].memo })).reverse())
      }
    }
    void load().catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [seller])

  if (!rows || rows.length === 0) return null
  const statusText = (s: number) => (s === STATUS.Paid ? 'Paid' : s === STATUS.Cancelled ? 'Cancelled' : 'Open')
  return (
    <section className="mine">
      <h2 className="h3">Your recent invoices</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <a {...linkProps(`/i/${row.id}`)}>
              <span className="mono">{usdc(row.amount)} USDC</span>
              <span className="muted">{row.memo || row.id.slice(0, 10)}</span>
              <span className={`pill pill-${row.status}`}>{statusText(row.status)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
