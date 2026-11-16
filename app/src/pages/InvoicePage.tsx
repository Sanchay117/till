import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { ChainTag, CopyButton, Qr, Timeline } from '../components'
import { HOME, NETWORKS, PAY_CHAINS, addressUrl, type NetworkKey } from '../config'
import { getDemoInfo, payDemo, startDemo, type DemoInfo } from '../demoApi'
import { seconds, shortAddress, timeLeft, usdc } from '../format'
import { useInvoice, useNow } from '../hooks'
import type { InvoiceView } from '../invoice'
import { linkProps, navigate } from '../router'

const STATE_TEXT: Record<InvoiceView['state'], string> = {
  open: 'Waiting for payment',
  partly: 'Part paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export function InvoicePage({ id }: { id: Hex }) {
  const { view, offline, hintPayment } = useInvoice(id)
  const [demo, setDemo] = useState<DemoInfo>({ enabled: false })
  useNow()

  useEffect(() => {
    void getDemoInfo().then(setDemo)
  }, [])

  if (view === undefined) {
    return (
      <main className="page narrow">
        <div className="receipt loading" aria-busy="true">
          <p className="muted">Looking up this invoice on {NETWORKS[HOME].name}…</p>
        </div>
      </main>
    )
  }
  if (view === null) {
    return (
      <main className="page narrow">
        <div className="receipt">
          <h1 className="h2">No invoice with this id</h1>
          <p className="muted">Check the link, or create a new one.</p>
          <a className="button" {...linkProps('/')}>
            Back to the start
          </a>
        </div>
      </main>
    )
  }

  const { invoice, state, steps } = view
  const isDemo = demo.enabled && invoice.seller.toLowerCase() === demo.address.toLowerCase()
  const ready = Boolean(steps.watching.tx) || view.watching
  const payable = (state === 'open' || state === 'partly') && ready
  const remaining = invoice.amount > invoice.received ? invoice.amount - invoice.received : 0n
  const paidOn = steps.payment.network

  return (
    <main className="page narrow">
      <article className={`receipt state-${state}`}>
        <header className="receipt-head">
          <span className="eyebrow">Invoice</span>
          <span className="mono muted">{id.slice(0, 10)}</span>
        </header>

        {invoice.memo && <p className="memo">{invoice.memo}</p>}

        <p className="amount">
          <span className="figure">{usdc(invoice.amount)}</span> <span className="unit">USDC</span>
        </p>

        <p className={`status status-${state}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {STATE_TEXT[state]}
          {state === 'partly' && `: ${usdc(invoice.received)} of ${usdc(invoice.amount)} received`}
          {(state === 'open' || state === 'partly') && <span className="muted"> · {timeLeft(invoice.expiresAt)}</span>}
        </p>

        {state === 'paid' && (
          <div className="paid-block">
            <span className="stamp" aria-hidden="true">
              Paid
            </span>
            <p>
              {paidOn ? (
                <>
                  Paid on <strong>{NETWORKS[paidOn].name}</strong>.{' '}
                </>
              ) : null}
              {view.secondsToPaid !== undefined ? (
                <>
                  Marked paid on {NETWORKS[HOME].name} <strong>{seconds(view.secondsToPaid)}</strong> later.
                </>
              ) : (
                <>Marked paid on {NETWORKS[HOME].name}.</>
              )}
            </p>
            <p className="fine">
              Nobody pressed anything, and no server was watching. The time is from block timestamps, which are whole
              seconds.
            </p>
          </div>
        )}

        {(state === 'open' || state === 'partly') && !ready && (
          <div className="notice">
            <span className="spinner" aria-hidden="true" />
            Reactive is starting to watch this invoice's address. This takes a couple of seconds.
          </div>
        )}

        {payable && (
          <section className="pay">
            <h2 className="h3">Pay this invoice</h2>
            <p>
              Send <strong>{usdc(remaining)} USDC</strong> to this address on any of these chains:
            </p>
            <p className="chains">
              {PAY_CHAINS.map((p) => (
                <ChainTag key={p.network.key} network={p.network.key} />
              ))}
            </p>
            <div className="deposit">
              <Qr text={invoice.depositAddress} label="Deposit address as a QR code" />
              <div>
                <code className="address">{invoice.depositAddress}</code>
                <div className="row">
                  <CopyButton text={invoice.depositAddress} label="Copy address" />
                </div>
                <p className="fine">
                  Any wallet or exchange withdrawal works. It is an ordinary transfer, and the address is the same on
                  every chain.
                </p>
              </div>
            </div>
            {isDemo && demo.enabled && <DemoPay id={id} demo={demo} onSent={hintPayment} sent={Boolean(steps.payment.tx)} />}
          </section>
        )}

        {state === 'expired' && (
          <p className="notice">This invoice expired unpaid. Money sent to its address now can still be forwarded to the seller.</p>
        )}

        <section>
          <h2 className="h3">What happened, and where</h2>
          <Timeline view={view} />
        </section>

        <footer className="receipt-foot">
          <dl>
            <div>
              <dt>Paid out to</dt>
              <dd>
                <AddressLink network={HOME} address={invoice.payTo} /> <span className="muted">only</span>
              </dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>
                <AddressLink network={HOME} address={invoice.seller} />
                {isDemo && <span className="muted"> (demo wallet)</span>}
              </dd>
            </div>
          </dl>
          <div className="row">
            <CopyButton text={window.location.href} label="Copy link to this invoice" />
          </div>
        </footer>
      </article>

      {offline && <p className="fine center">Having trouble reaching a chain. Still trying.</p>}

      {state === 'paid' && (
        <div className="after">
          {isDemo && <RunAgain />}
          <a className="button quiet" {...linkProps('/new')}>
            Create your own invoice
          </a>
        </div>
      )}
    </main>
  )
}

function AddressLink({ network, address }: { network: NetworkKey; address: string }) {
  const url = addressUrl(network, address)
  return url ? (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {shortAddress(address)}
    </a>
  ) : (
    <span className="mono">{shortAddress(address)}</span>
  )
}

function DemoPay({
  id, demo, onSent, sent,
}: {
  id: Hex
  demo: Extract<DemoInfo, { enabled: true }>
  onSent: (network: NetworkKey, tx: Hex) => void
  sent: boolean
}) {
  const [busy, setBusy] = useState<NetworkKey | null>(null)
  const [error, setError] = useState('')
  const funded = demo.chains.filter((c) => c.funded)

  async function pay(network: NetworkKey) {
    setBusy(network)
    setError('')
    try {
      const result = await payDemo(id, network)
      onSent(result.network, result.tx)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  if (sent) {
    return (
      <div className="demo">
        <span className="spinner" aria-hidden="true" />
        Payment sent from the demo wallet. Watch the steps below.
      </div>
    )
  }
  if (busy) {
    return (
      <div className="demo">
        <span className="spinner" aria-hidden="true" />
        Sending {usdc(BigInt(demo.amount))} test USDC from the demo wallet on {NETWORKS[busy].name}…
      </div>
    )
  }
  return (
    <div className="demo">
      <h3 className="h4">No wallet? Use the demo wallet.</h3>
      <p className="fine">It sends {usdc(BigInt(demo.amount))} test USDC to the address above, exactly as any payer would. Pick the chain:</p>
      <div className="row">
        {funded.map((c) => (
          <button key={c.key} type="button" className={c.key === HOME ? 'button quiet' : 'button'} onClick={() => pay(c.key)}>
            Pay on {c.name}
          </button>
        ))}
      </div>
      {funded.length === 0 && <p className="error">The demo wallet is out of test USDC right now.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function RunAgain() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            navigate(`/i/${(await startDemo()).id}`)
          } catch (e) {
            setError((e as Error).message)
          }
          setBusy(false)
        }}
      >
        {busy ? 'Creating an invoice…' : 'Run it again'}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  )
}
