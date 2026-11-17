import { useEffect, useState } from 'react'
import { ChainTag } from '../components'
import { HOME, INVOICE_BOOK, NETWORKS, PAY_CHAINS, REACTIVE, TILL, addressUrl } from '../config'
import { getDemoInfo, startDemo } from '../demoApi'
import patentSheet from '../assets/patent-221360-sheet-2.webp'
import { clock, usdc } from '../format'
import { Indicator } from '../Indicator'
import { linkProps, navigate } from '../router'
import { lastSales, useInvoiceCount, useReactiveBlock, type Sale } from '../sales'

export function Home() {
  const [demoReady, setDemoReady] = useState<boolean | null>(null)
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [replayed, setReplayed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const block = useReactiveBlock()
  const invoiceCount = useInvoiceCount()

  useEffect(() => {
    let stopped = false
    void getDemoInfo().then(async (info) => {
      if (stopped) return
      setDemoReady(info.enabled)
      if (!info.enabled) return setSales([])
      // The newest sale first, since the register above the fold is waiting for it. Then the tape.
      const newest = await lastSales(info.address, 1, 3).catch(() => [])
      if (stopped) return
      if (newest.length > 0) setSales(newest)
      const tape = await lastSales(info.address, 5, 12).catch(() => newest)
      if (!stopped) setSales(tape)
    })
    return () => {
      stopped = true
    }
  }, [])

  // The hero replays the last real sale once: the register starts at zero, then rings it up.
  const last = sales?.[0]
  useEffect(() => {
    if (!last) return
    const timer = window.setTimeout(() => setReplayed(true), 450)
    return () => window.clearTimeout(timer)
  }, [last])

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

  const actions = (
    <div className="row">
      {demoReady !== false && (
        <button type="button" className="key big" onClick={watchOne} disabled={busy || demoReady === null}>
          {busy ? 'Setting one up…' : 'Watch one get paid'}
        </button>
      )}
      <a className={demoReady === false ? 'key big' : 'key big plain'} {...linkProps('/new')}>
        Create an invoice
      </a>
    </div>
  )

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">After U.S. Patent 221,360 · 1879</p>
          <h1>An invoice that marks itself paid.</h1>
          <p className="lead">
            Send your client one address. They pay in USDC from any wallet, on whichever chain they use. The invoice marks
            itself paid and the money moves to your wallet.
          </p>
          {actions}
          {demoReady !== false && (
            <p className="fine">No wallet, no sign-up. A demo wallet pays a real ten-cent invoice with test USDC while you watch.</p>
          )}
          {error && <p className="error">{error}</p>}
        </div>

        <figure className="hero-plate">
          {/* Set like the head of the patent sheet it is drawn after. */}
          <p className="plate-head" aria-hidden="true">
            <span className="who">TILL.</span>
            <span className="what">Invoice Register and Indicator.</span>
            <span className="left">After No. 221,360.</span>
            <span className="right">{NETWORKS[HOME].name}, 2026.</span>
          </p>
          <Indicator
            amount={replayed && last ? last.amount : 0n}
            paid={replayed && Boolean(last)}
            watching
            label={last ? `The register shows the last sale: ${usdc(last.amount)} USDC, paid.` : 'The register, waiting for a sale.'}
          />
          <figcaption>
            <span className="caption-label">Last sale on the register</span>
            {sales === null && <span>Reading it from {NETWORKS[HOME].name}…</span>}
            {sales !== null && !last && <span>No sales yet. Yours could be the first.</span>}
            {last && (
              <>
                <span>
                  <strong>{usdc(last.amount)} USDC</strong>
                  {last.paidOn && <> paid on {NETWORKS[last.paidOn].name}</>}
                  {last.seconds !== undefined && (
                    <>
                      , marked paid on {NETWORKS[HOME].name} {last.seconds === 0 ? 'within a second' : `${last.seconds} s later`}
                    </>
                  )}
                  .
                </span>
                <a {...linkProps(`/i/${last.id}`)}>Follow its six transactions</a>
              </>
            )}
          </figcaption>
        </figure>
      </section>

      <dl className="strip" aria-label="Live from the chains">
        <div>
          <dt>Reactive Lasna block</dt>
          <dd>{block === null ? '…' : block.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Invoices on the books</dt>
          <dd>{invoiceCount === null ? '…' : invoiceCount.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Money</dt>
          <dd>Test USDC on testnets</dd>
        </div>
      </dl>

      <section className="story">
        <div className="story-inner">
          <div className="story-text">
            <p className="eyebrow">Dayton, Ohio · 1879</p>
            <h2>Somebody always had to watch the till.</h2>
            <p>
              James Ritty kept a saloon and suspected his bartenders of pocketing the takings. On a steamship to Europe he
              watched a device count the turns of the propeller. He came home and built one that counted sales, patented it
              on 4 November 1879, and called it the <em>Incorruptible Cashier</em>. The point was never the drawer. It was
              that nobody had to be trusted to watch it.
            </p>
            <p className="flip">
              Getting paid in stablecoins still has a watcher: a server with a key online, a bridge, or you with five block
              explorers open. Till takes the watcher out. One contract on Reactive Network hears the transfer land, on
              whichever chain, and does the rest.
            </p>
          </div>
          <figure className="sheet">
            <img
              src={patentSheet}
              width={880}
              height={1376}
              // Fetched up front but behind everything the first screen needs, so it is on the sheet
              // by the time anyone scrolls to it.
              fetchPriority="low"
              decoding="async"
              alt="Sheet 2 of U.S. Patent 221,360: engraved drawings of the Rittys' cash register, with a row of numbered wheels at the top and a dial numbered in fives below, signed by the inventors and two witnesses."
            />
            <figcaption>
              Sheet 2 of U.S. Patent 221,360, 4 November 1879. Fig. 3 shows the numbered wheels, Fig. 4 the dial.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="figs">
        <h2>How it works</h2>
        <ol>
          <li>
            <span className="fig-no">Fig. 1.</span>
            <h3>The invoice</h3>
            <p>
              You create it on {NETWORKS[HOME].name} and get one deposit address. It is the same address on every chain, and
              nothing is deployed there yet.
            </p>
          </li>
          <li>
            <span className="fig-no">Fig. 2.</span>
            <h3>The transfer</h3>
            <p>Your client sends USDC to that address from any wallet or exchange. They never touch a Till contract.</p>
            <p className="chains">
              {PAY_CHAINS.map((p) => (
                <ChainTag key={p.network.key} network={p.network.key} />
              ))}
            </p>
          </li>
          <li>
            <span className="fig-no">Fig. 3.</span>
            <h3>The indicator</h3>
            <p>
              A contract on Reactive Network hears the transfer. It marks the invoice paid on {NETWORKS[HOME].name} and
              sweeps the money to your wallet on the chain it arrived on.
            </p>
          </li>
        </ol>
        <p className="aside">
          <strong>Who can move the money?</strong> Only you receive it. A deposit address can pay exactly one address, the
          one you chose, and anyone can trigger that payment. Till never holds your funds.
        </p>
      </section>

      <section className="tape">
        <div className="tape-head">
          <h2>The tape</h2>
          <p>Every sale here is real and on a testnet. Open one to follow its six transactions across three chains.</p>
        </div>
        {sales && sales.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Rung up</th>
                <th scope="col">Amount</th>
                <th scope="col">Paid on</th>
                <th scope="col">Took</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{clock(sale.paidAt)}</td>
                  <td>{usdc(sale.amount)} USDC</td>
                  <td>{sale.paidOn ? <ChainTag network={sale.paidOn} /> : '—'}</td>
                  <td>{sale.seconds === undefined ? '—' : sale.seconds === 0 ? '<1 s' : `${sale.seconds} s`}</td>
                  <td>
                    <a {...linkProps(`/i/${sale.id}`)}>open</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="fine">{sales === null ? 'Reading the tape…' : 'The tape is empty on this deployment.'}</p>
        )}
        <p className="fine">
          "Took" runs from the payment landing to the invoice being marked paid, by block timestamps, which are whole seconds.
        </p>
        <ul className="contracts">
          <li>
            <ChainTag network={REACTIVE} /> <span>TillReactive</span> <ContractLink network={REACTIVE} address={TILL} />
          </li>
          <li>
            <ChainTag network={HOME} /> <span>InvoiceBook</span> <ContractLink network={HOME} address={INVOICE_BOOK} />
          </li>
        </ul>
      </section>

      <section className="close">
        <h2>Nobody has to watch it.</h2>
        {actions}
      </section>
    </main>
  )
}

function ContractLink({ network, address }: { network: typeof HOME; address: string }) {
  const url = addressUrl(network, address)
  return url ? (
    <a className="mono" href={url} target="_blank" rel="noreferrer">
      {address}
    </a>
  ) : (
    <span className="mono">{address}</span>
  )
}
