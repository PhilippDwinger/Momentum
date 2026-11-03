import type { CSSProperties, ReactNode } from 'react'

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  color = 'var(--accent)',
  track = 'var(--bg-sunken)',
  children,
  label,
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  children?: ReactNode
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <span className="ring" style={{ width: size, height: size } as CSSProperties} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      {children && <span className="ring-inner">{children}</span>}
    </span>
  )
}

export function Bar({ value, color, className = '' }: { value: number; color?: string; className?: string }) {
  return (
    <div className={`bar ${className}`} role="presentation">
      <span style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} />
    </div>
  )
}
