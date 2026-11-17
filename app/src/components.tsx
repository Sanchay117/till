import qrcode from 'qrcode-generator'
import { useMemo, useState } from 'react'
import { NETWORKS, txUrl, type NetworkKey } from './config'
import { shortHash } from './format'
import type { InvoiceView, StepKey } from './invoice'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="key small plain"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

/** A QR code as one SVG path. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
      }
    }
    return { path: d, size: count }
  }, [text])
  return (
    <svg className="qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#17130f" />
    </svg>
  )
}

export function ChainTag({ network }: { network: NetworkKey }) {
  return <span className={`chain chain-${network}`}>{NETWORKS[network].name}</span>
}

const STEP_ORDER: StepKey[] = ['created', 'watching', 'payment', 'reacted', 'marked', 'swept']

function stepLabel(key: StepKey): { title: string; detail: string } {
  switch (key) {
    case 'created':
      return { title: 'Invoice created', detail: 'The seller adds it to the books.' }
    case 'watching':
      return { title: 'Reactive starts watching', detail: 'It subscribes to USDC transfers into the deposit address, on every pay chain.' }
    case 'payment':
      return { title: 'Payment lands', detail: 'An ordinary USDC transfer. No Till contract is called.' }
    case 'reacted':
      return { title: 'Reactive sees the transfer', detail: 'One reactive transaction adds it up and requests two callbacks.' }
    case 'marked':
      return { title: 'Invoice marked paid', detail: 'Callback one, to the chain the books live on.' }
    case 'swept':
      return { title: 'Money swept to the seller', detail: 'Callback two, to the chain the money landed on.' }
  }
}

/** The six steps of an invoice's life, each with its chain, its transaction and when it happened. */
export function Timeline({ view }: { view: InvoiceView }) {
  const paidAt = view.steps.payment.time
  const firstPending = STEP_ORDER.find((key) => !view.steps[key].tx)
  const live = view.state === 'open' || view.state === 'partly' || (view.state === 'paid' && firstPending !== undefined)

  return (
    <ol className="timeline">
      {STEP_ORDER.map((key) => {
        const step = view.steps[key]
        const { title, detail } = stepLabel(key)
        // A demo payment's hash is known before it is in a block. Until then it has not "landed".
        const confirming = key === 'payment' && Boolean(step.tx) && step.time === undefined
        const done = Boolean(step.tx) && !confirming
        // The sweep's block is not recorded on-chain, so it is searched for, and the search can end empty.
        const gaveUp = key === 'swept' && !step.tx && view.sweepSearchDone
        const current = !gaveUp && ((live && key === firstPending) || confirming)
        const url = step.tx && step.network ? txUrl(step.network, step.tx) : undefined
        // Times are shown relative to the payment, since that is the moment the clock starts.
        let when = ''
        if (done && step.time !== undefined && paidAt !== undefined && key !== 'created' && key !== 'watching') {
          const after = Math.max(0, step.time - paidAt)
          when = key === 'payment' ? '0 s' : after === 0 ? '<1 s' : `+${after} s`
        }
        return (
          <li key={key} className={done ? 'done' : current ? 'current' : 'pending'}>
            <span className="dot" aria-hidden="true" />
            <div className="what">
              <strong>{title}</strong>
              <span className="detail">{detail}</span>
            </div>
            <div className="where">
              {step.network ? <ChainTag network={step.network} /> : <span className="chain chain-unknown">any pay chain</span>}
              {when && <span className="when">{when}</span>}
              {done &&
                (url ? (
                  <a className="tx" href={url} target="_blank" rel="noreferrer">
                    {shortHash(step.tx!)} ↗
                  </a>
                ) : (
                  <span className="tx">{shortHash(step.tx!)}</span>
                ))}
              {!done && (
                <span className="tx waiting">
                  {gaveUp ? 'not found nearby' : confirming ? 'confirming…' : current ? 'waiting…' : 'not yet'}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
