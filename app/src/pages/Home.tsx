import { useEffect, useState } from 'react'
import { ChainTag } from '../components'
import { HOME, INVOICE_BOOK, NETWORKS, PAY_CHAINS, REACTIVE, TILL, addressUrl } from '../config'
import { getDemoInfo, startDemo } from '../demoApi'
import { linkProps, navigate } from '../router'

export function Home() {
  const [demoReady, setDemoReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void getDemoInfo().then((info) => setDemoReady(info.enabled))
  }, [])

  async function watchOne() {
    setBusy(true)
    setError('')
    try {
      navigate(`/i/${(await startDemo()).id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const tillUrl = addressUrl(REACTIVE, TILL)
  const bookUrl = addressUrl(HOME, INVOICE_BOOK)

  return (
    <main className="page">
      <section className="hero">
        <h1>An invoice that marks itself paid.</h1>
        <p className="lead">
          Send your client one address. They pay in USDC from any wallet, on whichever chain they use. The invoice marks
          itself paid and the money moves to your wallet.
        </p>
        <ul className="nots">
          <li>No server watching chains</li>
          <li>No bridge</li>
          <li>Nobody presses anything</li>
        </ul>
        <div className="row">
          {demoReady !== false && (
            <button type="button" className="button big" onClick={watchOne} disabled={busy || demoReady === null}>
              {busy ? 'Setting one up…' : 'Watch one get paid'}
            </button>
          )}
          <a className={demoReady === false ? 'button big' : 'button big quiet'} {...linkProps('/new')}>
            Create an invoice
          </a>
        </div>
        {demoReady !== false && (
          <p className="fine">No wallet or sign-up. A demo wallet pays a real invoice with test USDC while you watch.</p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="steps">
        <h2>How it works</h2>
        <ol>
          <li>
            <h3>You create an invoice</h3>
            <p>
              On {NETWORKS[HOME].name}. You get one deposit address. It is the same on every chain, and nothing is deployed
              there yet.
            </p>
          </li>
          <li>
            <h3>Your client pays</h3>
            <p>An ordinary USDC transfer on any of the chains below. They never touch a Till contract.</p>
            <p className="chains">
              {PAY_CHAINS.map((p) => (
                <ChainTag key={p.network.key} network={p.network.key} />
              ))}
            </p>
          </li>
          <li>
            <h3>It marks itself paid</h3>
            <p>
              A contract on Reactive Network sees the transfer, marks the invoice paid on {NETWORKS[HOME].name}, and sweeps
              the money to your wallet.
            </p>
          </li>
        </ol>
      </section>

      <section className="two">
        <div>
          <h2>Who can move the money?</h2>
          <p>
            Only you receive it. A deposit address can pay exactly one address, the one you chose when you made the
            invoice, and anyone can trigger that payment. Till never holds your funds.
          </p>
        </div>
        <div>
          <h2>Why it needs Reactive</h2>
          <p>
            The chain the money lands on and the chain your books live on cannot see each other. Usually a server with a
            key online fills that gap. Here one contract on Reactive Network does. It subscribes to transfers into your
            invoice's address on every chain, then calls back to both chains when one arrives.
          </p>
        </div>
      </section>

      <section className="contracts">
        <h2>Live on testnet</h2>
        <p className="fine">Test USDC only. Every step of every invoice links to its transaction.</p>
        <ul>
          <li>
            <ChainTag network={REACTIVE} /> TillReactive{' '}
            {tillUrl ? (
              <a className="mono" href={tillUrl} target="_blank" rel="noreferrer">
                {TILL}
              </a>
            ) : (
              <span className="mono">{TILL}</span>
            )}
          </li>
          <li>
            <ChainTag network={HOME} /> InvoiceBook{' '}
            {bookUrl ? (
              <a className="mono" href={bookUrl} target="_blank" rel="noreferrer">
                {INVOICE_BOOK}
              </a>
            ) : (
              <span className="mono">{INVOICE_BOOK}</span>
            )}
          </li>
        </ul>
      </section>
    </main>
  )
}
