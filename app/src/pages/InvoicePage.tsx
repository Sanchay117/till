import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import { ChainTag, CopyButton, Qr, Timeline } from '../components'
import { HOME, NETWORKS, PAY_CHAINS, addressUrl, type NetworkKey } from '../config'
import { demoChains, getDemoInfo, payDemo, startDemo, type DemoInfo } from '../demoApi'
import { seconds, shortAddress, timeLeft, usdc } from '../format'
import { useInvoice, useNow } from '../hooks'
import { Indicator, Mark } from '../Indicator'
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
          <Mark ticking className="large" />
          <p className="muted">Looking up this invoice on {NETWORKS[HOME].name}…</p>
        </div>
      </main>
    )
  }
  if (view === null) {
    return (
      <main className="page narrow">
        <div className="receipt">
          <h1 className="h2">No invoice with this number</h1>
          <p className="muted">Check the link, or start again.</p>
          <a className="key" {...linkProps('/')}>
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
          <span className="mono muted">No. {id.slice(2, 10)}</span>
        </header>

        <div className="receipt-top">
          <div className="receipt-sum">
            {invoice.memo && <p className="memo">{invoice.memo}</p>}
            <p className="amount">
              <span className="figure">{usdc(invoice.amount)}</span> <span className="unit">USDC</span>
            </p>
            <p className={`status status-${state}`} role="status">
              {STATE_TEXT[state]}
              {state === 'partly' && `: ${usdc(invoice.received)} of ${usdc(invoice.amount)} received`}
              {(state === 'open' || state === 'partly') && <span className="muted"> · {timeLeft(invoice.expiresAt)}</span>}
            </p>
          </div>
          <Indicator
            className="small"
            amount={invoice.received}
            paid={state === 'paid'}
            watching={view.watching}
            label={`The register shows ${usdc(invoice.received)} USDC received. ${STATE_TEXT[state]}.`}
          />
        </div>

        {state === 'paid' && (
          <div className="paid-block">
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
            <Mark ticking />
            Reactive is starting to watch this invoice's address. This takes a couple of seconds.
          </div>
        )}

        {/* On a demo invoice the next click is the demo wallet, so it comes first and stays above the fold. */}
        {payable && isDemo && demo.enabled && (
          <DemoPay id={id} demo={demo} onSent={hintPayment} sent={Boolean(steps.payment.tx)} />
        )}

        {payable && (
          <section className="pay">
            <h2 className="h3">{isDemo ? 'Or pay it yourself' : 'Pay this invoice'}</h2>
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
                {isDemo && invoice.payTo.toLowerCase() !== invoice.seller.toLowerCase() && (
                  <span className="muted">, the demo seller's wallet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>
                <AddressLink network={HOME} address={invoice.seller} />
                {isDemo && <span className="muted"> (the demo wallet, which also pays it)</span>}
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
          <a className="key plain" {...linkProps('/new')}>
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
  const [funded, setFunded] = useState<NetworkKey[] | null>(null)

  useEffect(() => {
    void demoChains(demo).then(setFunded)
  }, [demo])

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
      <div className="demo working">
        <Mark ticking />
        Payment sent from the demo wallet. Watch the register.
      </div>
    )
  }
  if (busy) {
    return (
      <div className="demo working">
        <Mark ticking />
        Sending {usdc(BigInt(demo.amount))} test USDC from the demo wallet on {NETWORKS[busy].name}…
      </div>
    )
  }
  return (
    <div className="demo">
      <h3 className="h4">No wallet? Use the demo wallet.</h3>
      <p className="fine">It sends {usdc(BigInt(demo.amount))} test USDC to this invoice's address, exactly as any payer would. Pick the chain:</p>
      <div className="row">
        {funded === null && <Mark ticking />}
        {funded?.map((key) => (
          <button key={key} type="button" className={key === HOME ? 'key plain' : 'key'} onClick={() => pay(key)}>
            Pay on {NETWORKS[key].name}
          </button>
        ))}
      </div>
      {funded?.length === 0 && <p className="error">The demo wallet is out of test USDC right now.</p>}
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
        className="key"
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
