// The register and its indicator, after U.S. Patent 221,360 (J. & J. Ritty, 1879), "Cash Register
// and Indicator". The patent's machine had two parts, and so does this one:
//   - the register: numbered wheels that keep the count (here, whole dollars received)
//   - the indicator: a dial whose hand shows the sale to the customer (here, the cents)
// It is not decoration. It shows what an invoice has actually received, and it is the app's
// loading spinner, logo and favicon as well.
import { useMemo } from 'react'

const CX = 180
const CY = 252
const WHEEL_W = 40
const WHEEL_H = 50
const WHEEL_GAP = 6

function polar(radius: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180
  return [CX + radius * Math.sin(rad), CY - radius * Math.cos(rad)]
}

interface IndicatorProps {
  /** What the register has received, in USDC base units (six decimals). */
  amount: bigint
  paid: boolean
  /** Is Till watching for a payment right now? Gives the hand a slight tick. */
  watching?: boolean
  /** Read out by screen readers in place of the drawing. */
  label: string
  className?: string
}

export function Indicator({ amount, paid, watching = false, label, className = '' }: IndicatorProps) {
  const dollars = (amount / 1_000_000n).toString()
  const cents = Number(amount % 1_000_000n) / 10_000 // 0 to 99.9999
  const digits = dollars.padStart(4, '0').split('').map(Number)
  // A paid invoice sends the hand once right round the dial before it settles on the cents.
  const angle = cents * 3.6 + (paid ? 360 : 0)

  const windowWidth = digits.length * WHEEL_W + (digits.length - 1) * WHEEL_GAP
  const windowX = CX - windowWidth / 2

  const face = useMemo(() => {
    const numerals = []
    const ticks = []
    for (let cent = 0; cent < 100; cent++) {
      const major = cent % 5 === 0
      const [x1, y1] = polar(major ? 113 : 119, cent * 3.6)
      const [x2, y2] = polar(124, cent * 3.6)
      ticks.push(<line key={cent} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'tick major' : 'tick'} />)
      if (major) {
        const [x, y] = polar(99, cent * 3.6)
        numerals.push(
          <text key={cent} x={x} y={y} className="numeral">
            {cent}
          </text>,
        )
      }
    }
    return { numerals, ticks }
  }, [])

  return (
    <svg
      className={`indicator ${paid ? 'is-paid' : ''} ${watching && !paid ? 'is-watching' : ''} ${className}`}
      viewBox="0 0 360 478"
      role="img"
      aria-label={label}
    >
      <defs>
        <clipPath id="wheel-window">
          <rect x={windowX} y="30" width={windowWidth} height={WHEEL_H} />
        </clipPath>
      </defs>

      {/* The register: one wheel per digit of whole dollars. */}
      <text x={windowX - 20} y="60" className="fig" textAnchor="end">
        Fig. 1.
      </text>
      <rect x={windowX - 9} y="21" width={windowWidth + 18} height={WHEEL_H + 18} rx="3" className="line" />
      <g clipPath="url(#wheel-window)">
        {digits.map((digit, i) => {
          const x = windowX + i * (WHEEL_W + WHEEL_GAP)
          return (
            <g key={digits.length - i}>
              <rect x={x} y="30" width={WHEEL_W} height={WHEEL_H} className="wheel" />
              <g className="wheel-strip" style={{ transform: `translateY(${-digit * WHEEL_H}px)`, transitionDelay: `${(digits.length - 1 - i) * 90}ms` }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <text key={n} x={x + WHEEL_W / 2} y={30 + WHEEL_H / 2 + n * WHEEL_H} className="wheel-digit">
                    {n}
                  </text>
                ))}
              </g>
            </g>
          )
        })}
      </g>
      <text x={CX} y="103" className="caption">
        DOLLARS
      </text>

      {/* The stem between register and dial. */}
      <path d={`M${CX - 7} 110V124M${CX + 7} 110V124`} className="line" />

      {/* The indicator: a dial of cents. */}
      <text x="42" y="150" className="fig">
        Fig. 2.
      </text>
      <circle cx={CX} cy={CY} r="130" className="line heavy" />
      <circle cx={CX} cy={CY} r="124" className="line" />
      {face.ticks}
      {face.numerals}
      <text x={CX} y={CY + 52} className="caption">
        CENTS
      </text>

      <g className="hand" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <g className="hand-tick" style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <path d={`M${CX - 4.5} ${CY + 20}L${CX} ${CY - 92}L${CX + 4.5} ${CY + 20}Z`} className="solid" />
          <circle cx={CX} cy={CY + 26} r="7" className="solid" />
        </g>
      </g>
      <circle cx={CX} cy={CY} r="11" className="hub" />
      <circle cx={CX} cy={CY} r="3.5" className="solid" />

      {/* The plinth, and the plate that says whether a sale has been rung up. */}
      <path d="M58 392H302M70 399H290" className="line" />
      <g className="plate">
        <rect x="94" y="418" width="172" height="46" rx="3" className="plate-slot" />
        <text x={CX} y="442" className="plate-idle">
          NO SALE
        </text>
        <g className="plate-paid">
          <rect x="94" y="418" width="172" height="46" rx="3" className="plate-face" />
          <circle cx="104" cy="428" r="2" className="plate-screw" />
          <circle cx="256" cy="428" r="2" className="plate-screw" />
          <circle cx="104" cy="454" r="2" className="plate-screw" />
          <circle cx="256" cy="454" r="2" className="plate-screw" />
          <text x={CX} y="442" className="plate-word">
            PAID
          </text>
        </g>
      </g>
    </svg>
  )
}

/** The dial alone: Till's logo, and with `ticking` its loading spinner. */
export function Mark({ ticking = false, className = '' }: { ticking?: boolean; className?: string }) {
  return (
    <svg className={`mark ${ticking ? 'is-ticking' : ''} ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" className="mark-ring" />
      <path d="M16 3.5v3.2M28.5 16h-3.2M16 28.5v-3.2M3.5 16h3.2" className="mark-ring" />
      <g className="mark-hand">
        <path d="M16 17.5V7.2" className="mark-ring" />
      </g>
      <circle cx="16" cy="16" r="2.3" className="mark-hub" />
    </svg>
  )
}
