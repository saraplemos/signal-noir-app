/**
 * DecisionInfluenceMatrix
 * Signal Noir™ — Decision Influence Funnel + Matrix combined visualization
 *
 * Usage:
 *   <DecisionInfluenceMatrix
 *     scores={{ d1: 7.2, d2: 5.8, d3: 4.5, d4: 6.9, d5: 3.8, d6: 5.1 }}
 *     brandName="Londra Palace Venezia"
 *   />
 *
 * Score mapping (D1–D6, each 0–10):
 *   D1  Authority (domain/editorial authority)      → upstream influence
 *   D2  AI Citations                                → discovery stage
 *   D3  Content Structure                           → downstream/consideration
 *   D4  Topical Authority                           → upstream influence
 *   D5  Search Visibility                           → downstream/decision
 *   D6  Social Amplification                        → upstream/inspiration
 *
 * Matrix position logic:
 *   X axis  = downstream score / (upstream + downstream) × 100
 *             Inspiration end (left) ←→ Decision end (right)
 *   Y axis  = avg(D1, D4) × 10
 *             Weak (bottom) ←→ Strong authority (top)
 */

import { useMemo } from 'react'

const FUNNEL_STAGES = [
  {
    label: 'Inspiration',
    sub: 'Authority origination',
    points: '5,5 235,5 210,63 30,63',
    darkFill: '#26215C',
    lightFill: '#EEEDFE',
    textColor: null, // uses adaptive class
  },
  {
    label: 'Discovery',
    sub: 'Citation & corroboration',
    points: '30,68 210,68 188,126 52,126',
    darkFill: '#3C3489',
    lightFill: '#CECBF6',
    textColor: null,
  },
  {
    label: 'Consideration',
    sub: 'Interpretation & clarity',
    points: '52,131 188,131 168,189 72,189',
    darkFill: '#534AB7',
    lightFill: '#AFA9EC',
    textColor: null,
  },
  {
    label: 'Decision',
    sub: 'Conversion capture',
    points: '72,194 168,194 158,248 82,248',
    darkFill: '#7F77DD',
    lightFill: '#7F77DD',
    textColor: '#ffffff',
    subColor: '#CECBF6',
  },
]

const QUADRANTS = {
  topRight: {
    label: 'Dominant influence',
    description: 'Consistently surfaced and recommended',
  },
  topLeft: {
    label: 'Editorial authority, lost value',
    description: 'Shapes perception, weak downstream',
  },
  bottomRight: {
    label: 'Conversion-led',
    description: 'Captures demand, rarely creates it',
  },
  bottomLeft: {
    label: 'Invisible',
    description: 'Neither discovered nor chosen',
  },
}

function calcPosition(scores) {
  const { d1 = 5, d2 = 5, d3 = 5, d4 = 5, d5 = 5, d6 = 5 } = scores
  const upstream = d1 * 0.4 + d4 * 0.4 + d6 * 0.2
  const downstream = d3 * 0.5 + d5 * 0.5
  const total = upstream + downstream
  const x = total > 0 ? (downstream / total) * 100 : 50
  const y = ((d1 + d4) / 2) * 10
  return {
    x: Math.min(92, Math.max(8, x)),
    y: Math.min(92, Math.max(8, y)),
  }
}

function getQuadrantKey(x, y) {
  const right = x >= 50
  const top = y >= 50
  if (top && right) return 'topRight'
  if (top && !right) return 'topLeft'
  if (!top && right) return 'bottomRight'
  return 'bottomLeft'
}

// Inline SVG funnel
function Funnel() {
  return (
    <svg viewBox="0 0 240 275" width="100%" style={{ display: 'block' }}>
      {FUNNEL_STAGES.map((stage, i) => {
        const cy = i * 63 + (i === 0 ? 34 : i === 1 ? 97 : i === 2 ? 160 : 221)
        const subY = cy + 14
        return (
          <g key={stage.label}>
            <polygon
              points={stage.points}
              style={{
                fill: stage.lightFill,
                stroke: 'rgba(100,100,100,0.15)',
                strokeWidth: 0.5,
              }}
              className="sn-funnel-polygon"
              data-dark-fill={stage.darkFill}
              data-light-fill={stage.lightFill}
            />
            <text
              x="120"
              y={cy}
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fontFamily="inherit"
              style={{ fill: stage.textColor || 'inherit' }}
              className={stage.textColor ? '' : 'sn-funnel-text'}
            >
              {stage.label}
            </text>
            <text
              x="120"
              y={subY}
              textAnchor="middle"
              fontSize="9"
              fontFamily="inherit"
              opacity={stage.textColor ? 1 : 0.7}
              style={{ fill: stage.subColor || (stage.textColor ? stage.subColor : 'inherit') }}
              className={stage.textColor ? '' : 'sn-funnel-text'}
            >
              {stage.sub}
            </text>
          </g>
        )
      })}

      {/* Annotation: influence created / demand captured */}
      <line x1="240" y1="68" x2="240" y2="189" stroke="rgba(100,100,100,0.2)" strokeWidth="0.5" strokeDasharray="3 3" />
      <text x="238" y="124" textAnchor="end" fontSize="8" fill="rgba(100,100,100,0.6)" fontFamily="inherit">
        ← influence
      </text>
      <text x="238" y="135" textAnchor="end" fontSize="8" fill="rgba(100,100,100,0.6)" fontFamily="inherit">
        created here
      </text>
      <text x="238" y="218" textAnchor="end" fontSize="8" fill="rgba(100,100,100,0.6)" fontFamily="inherit">
        ← demand
      </text>
      <text x="238" y="229" textAnchor="end" fontSize="8" fill="rgba(100,100,100,0.6)" fontFamily="inherit">
        captured here
      </text>
    </svg>
  )
}

// 2×2 matrix grid + animated dot
function Matrix({ xPct, yPct }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Y axis header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 8.5, color: 'rgba(150,150,150,0.8)' }}>Strong</span>
        <span style={{ fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(150,150,150,0.8)' }}>
          Authority strength
        </span>
        <span />
      </div>

      <div
        style={{
          position: 'relative',
          border: '0.5px solid rgba(150,150,150,0.3)',
          borderRadius: 8,
          overflow: 'hidden',
          aspectRatio: '1',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            height: '100%',
          }}
        >
          {/* Top-left */}
          <QuadrantCell q={QUADRANTS.topLeft} borderRight borderBottom subtle />
          {/* Top-right */}
          <QuadrantCell q={QUADRANTS.topRight} borderBottom />
          {/* Bottom-left */}
          <QuadrantCell q={QUADRANTS.bottomLeft} borderRight subtle />
          {/* Bottom-right */}
          <QuadrantCell q={QUADRANTS.bottomRight} />
        </div>

        {/* Brand dot */}
        <div
          style={{
            position: 'absolute',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ffffff',
            border: '2px solid rgba(83,74,183,0.8)',
            boxShadow: '0 0 0 3px rgba(83,74,183,0.2)',
            transform: 'translate(-50%, 50%)',
            transition: 'left 0.65s cubic-bezier(.4,0,.2,1), bottom 0.65s cubic-bezier(.4,0,.2,1)',
            left: `${xPct}%`,
            bottom: `${yPct}%`,
          }}
        />
      </div>

      {/* X axis footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 8.5, color: 'rgba(150,150,150,0.8)' }}>Inspiration</span>
        <span style={{ fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(150,150,150,0.8)' }}>
          Decision influence
        </span>
        <span style={{ fontSize: 8.5, color: 'rgba(150,150,150,0.8)' }}>Decision</span>
      </div>
    </div>
  )
}

function QuadrantCell({ q, borderRight, borderBottom, subtle }) {
  return (
    <div
      style={{
        padding: 8,
        borderRight: borderRight ? '0.5px solid rgba(150,150,150,0.2)' : undefined,
        borderBottom: borderBottom ? '0.5px solid rgba(150,150,150,0.2)' : undefined,
        background: subtle ? 'rgba(0,0,0,0.05)' : undefined,
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 500, lineHeight: 1.3 }}>{q.label}</div>
      <div style={{ fontSize: 8, opacity: 0.6, marginTop: 3, lineHeight: 1.4 }}>{q.description}</div>
    </div>
  )
}

// Main export
export default function DecisionInfluenceMatrix({ scores = {}, brandName }) {
  const { x, y } = useMemo(() => calcPosition(scores), [scores])
  const quadrantKey = getQuadrantKey(x, y)
  const quadrant = QUADRANTS[quadrantKey]

  return (
    <div style={{ fontFamily: 'inherit', color: 'inherit' }}>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.5, marginBottom: 2 }}>
            Signal Noir™
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            Where influence is created and where it is captured
          </div>
          {brandName && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{brandName}</div>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 6,
            border: '0.5px solid rgba(150,150,150,0.35)',
            opacity: 0.85,
            whiteSpace: 'nowrap',
          }}
        >
          {quadrant.label}
        </div>
      </div>

      {/* Main visualization row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Funnel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Funnel />
        </div>

        {/* Connector */}
        <div style={{ width: 56, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 8.5, opacity: 0.5, textAlign: 'center', lineHeight: 1.4 }}>
            Funnel shows how influence is created
          </div>
          <svg width="18" height="12" viewBox="0 0 18 12">
            <path d="M1 6 L15 6 M10 2 L15 6 L10 10" fill="none" stroke="rgba(150,150,150,0.5)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 8.5, opacity: 0.5, textAlign: 'center', lineHeight: 1.4 }}>
            Matrix shows where you stand
          </div>
        </div>

        {/* Matrix */}
        <Matrix xPct={x} yPct={y} />
      </div>

      {/* Anchor line */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          fontStyle: 'italic',
          opacity: 0.45,
          padding: '12px 0',
          borderTop: '0.5px solid rgba(150,150,150,0.2)',
          marginTop: 12,
        }}
      >
        Brands don't win at the point of decision. They win in the moments that shape it.
      </div>
    </div>
  )
}
