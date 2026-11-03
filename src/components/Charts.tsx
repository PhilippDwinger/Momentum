import { useState, type ReactNode } from 'react'
import { addDays, startOfWeek } from '../domain/dates'
import { heatLevel, type DaySummary } from '../domain/stats'
import type { DateKey } from '../domain/types'
import { useI18n } from '../i18n'

/**
 * Lightweight SVG/HTML charts (no chart library): theme-aware via CSS variables,
 * thin marks, recessive axes, a hover tooltip on every mark.
 */

interface Tip {
  x: number
  y: number
  content: ReactNode
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Heatmap (GitHub-style). Columns are weeks, rows are weekdays.
// ---------------------------------------------------------------------------

export function Heatmap({
  days,
  today,
  weeks = 53,
  weekStartsOn = 1,
  onSelect,
}: {
  days: Map<DateKey, DaySummary>
  today: DateKey
  weeks?: number
  weekStartsOn?: 0 | 1
  onSelect?: (d: DateKey) => void
}) {
  const { t, fmt } = useI18n()
  const [tip, setTip] = useState<Tip | null>(null)
  const lastWeek = startOfWeek(today, weekStartsOn)
  const first = addDays(lastWeek, -7 * (weeks - 1))
  const cols = Array.from({ length: weeks }, (_, w) => addDays(first, w * 7))
  const legend = [
    ['0', t('stats.heat.none')],
    ['1', t('stats.heat.zero')],
    ['2', t('stats.heat.some')],
    ['3', t('stats.heat.most')],
    ['4', t('stats.heat.all')],
  ]
  return (
    <div className="heatmap-wrap" onMouseLeave={() => setTip(null)}>
      <div className="heatmap-scroll" data-noswipe>
        <div className="heatmap-months" aria-hidden style={{ gridTemplateColumns: `repeat(${weeks}, minmax(var(--cell), 1fr))` }}>
          {cols.map((c, i) => {
            const prev = i > 0 ? cols[i - 1] : null
            const show = !prev || c.slice(5, 7) !== prev.slice(5, 7)
            return <span key={c}>{show && i < weeks - 2 ? fmt.monthShort(addDays(c, 6)) : ''}</span>
          })}
        </div>
        <div className="heatmap" role="grid" aria-label={t('stats.heatmap')} style={{ gridTemplateColumns: `repeat(${weeks}, minmax(var(--cell), 1fr))` }}>
          {cols.map((c) => (
            <div key={c} className="heat-col" role="row">
              {Array.from({ length: 7 }, (_, r) => {
                const d = addDays(c, r)
                const s = days.get(d)
                const lvl = heatLevel(s, today)
                const label =
                  lvl === -1
                    ? fmt.medium(d)
                    : s && s.planned > 0
                      ? t('stats.tooltip', { date: fmt.medium(d), done: s.done, planned: s.planned })
                      : t('stats.tooltipNone', { date: fmt.medium(d) })
                return (
                  <button
                    key={d}
                    role="gridcell"
                    className={`heat-cell l${lvl === -1 ? 'f' : lvl}${d === today ? ' today' : ''}`}
                    aria-label={label}
                    onClick={() => onSelect?.(d)}
                    onMouseEnter={(e) => {
                      const host = (e.currentTarget.closest('.heatmap-wrap') as HTMLElement).getBoundingClientRect()
                      const r2 = e.currentTarget.getBoundingClientRect()
                      setTip({ x: r2.left - host.left + r2.width / 2, y: r2.top - host.top, content: label })
                    }}
                    tabIndex={-1}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-legend" aria-hidden>
        {legend.map(([l, label]) => (
          <span key={l} className="heat-legend-item">
            <span className={`heat-cell l${l}`} /> {label}
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bar chart (rates 0..1). Single series → no legend; the title names it.
// ---------------------------------------------------------------------------

export interface BarDatum {
  key: string
  label: string
  value: number | null
  detail: string
  highlight?: boolean
}

export function BarChart({ data, height = 160, format }: { data: BarDatum[]; height?: number; format: (v: number | null) => string }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const max = 1
  return (
    <div className="bar-chart" style={{ height }} onMouseLeave={() => setTip(null)}>
      <div className="bar-grid" aria-hidden>
        {[1, 0.5, 0].map((g) => (
          <span key={g} style={{ bottom: `${g * 100}%` }}>
            <em>{format(g)}</em>
          </span>
        ))}
      </div>
      <div className="bar-cols" role="list">
        {data.map((d) => (
          <div
            key={d.key}
            className={`bar-col${d.highlight ? ' highlight' : ''}`}
            role="listitem"
            aria-label={`${d.label}: ${format(d.value)} – ${d.detail}`}
            onMouseEnter={(e) => {
              const host = (e.currentTarget.closest('.bar-chart') as HTMLElement).getBoundingClientRect()
              const r = e.currentTarget.getBoundingClientRect()
              setTip({
                x: r.left - host.left + r.width / 2,
                y: Math.max(0, r.bottom - host.top - ((d.value ?? 0) / max) * (r.height - 22) - 8),
                content: (
                  <>
                    <strong>{d.label}</strong> · {format(d.value)}
                    <br />
                    <span>{d.detail}</span>
                  </>
                ),
              })
            }}
          >
            <div className="bar-track">
              {d.value === null ? <span className="bar-empty" /> : <span className="bar-fill" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />}
            </div>
            <span className="bar-label">{d.label}</span>
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line chart (rates 0..1) with crosshair tooltip.
// ---------------------------------------------------------------------------

export function LineChart({ data, height = 170, format }: { data: BarDatum[]; height?: number; format: (v: number | null) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const w = 600
  const h = height
  const padX = 14
  const padTop = 14
  const padBottom = 26
  const innerH = h - padTop - padBottom
  const x = (i: number) => padX + (data.length <= 1 ? (w - 2 * padX) / 2 : (i * (w - 2 * padX)) / (data.length - 1))
  const y = (v: number) => padTop + (1 - v) * innerH
  const segments: string[] = []
  let current = ''
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current) segments.push(current)
      current = ''
      return
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`
  })
  if (current) segments.push(current)
  const hd = hover !== null ? data[hover] : null
  return (
    <div className="line-chart" onMouseLeave={() => setHover(null)}>
      <div className="line-y" aria-hidden>
        {[1, 0.5, 0].map((g) => (
          <span key={g} style={{ top: `${(y(g) / h) * 100}%` }}>
            {format(g)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(', ')}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={padX} x2={w - padX} y1={y(g)} y2={y(g)} className="grid-line" vectorEffect="non-scaling-stroke" />
        ))}
        {segments.map((p, i) => (
          <path key={i} d={p} className="line-path" vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && hd && <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={h - padBottom} className="crosshair" vectorEffect="non-scaling-stroke" />}
        {data.map((d, i) =>
          d.value === null ? null : <circle key={d.key} cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3.5} className="line-dot" vectorEffect="non-scaling-stroke" />,
        )}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.key}`}
            x={x(i) - (w - 2 * padX) / Math.max(1, data.length - 1) / 2}
            y={0}
            width={(w - 2 * padX) / Math.max(1, data.length - 1)}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="line-labels" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} style={{ left: `${(x(i) / w) * 100}%` }}>
            {i % Math.ceil(data.length / 6) === 0 || i === data.length - 1 ? d.label : ''}
          </span>
        ))}
      </div>
      {hd && hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / w) * 100}%`, top: hd.value === null ? 0 : (y(hd.value) / h) * 100 + '%' }}>
          <strong>{hd.label}</strong> · {format(hd.value)}
          <br />
          <span>{hd.detail}</span>
        </div>
      )}
    </div>
  )
}

/** Horizontal rate bars, e.g. per weekday or category. */
export function RateRows({ rows, format }: { rows: { key: string; label: ReactNode; value: number | null; detail: string; color?: string }[]; format: (v: number | null) => string }) {
  return (
    <ul className="rate-rows">
      {rows.map((r) => (
        <li key={r.key} title={r.detail}>
          <span className="rate-label">{r.label}</span>
          <span className="rate-track">
            <span style={{ width: `${(r.value ?? 0) * 100}%`, background: r.color }} />
          </span>
          <span className="rate-value num">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}
