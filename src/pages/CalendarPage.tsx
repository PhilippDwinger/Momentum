import { useMemo, useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { OccurrenceList } from '../components/Checklist'
import { acStyle } from '../components/Icon'
import { ProgressRing } from '../components/Progress'
import { useOccurrenceActions } from '../components/useOccurrenceActions'
import { addDays, addMonths, isDateKey, isoWeek, parseKey, startOfMonth, startOfWeek, weekday } from '../domain/dates'
import { getOccurrence, isPlanned, occurrencesByDate, statusOf } from '../domain/occurrences'
import { dayLoad } from '../domain/scheduling'
import { summarizeDay } from '../domain/stats'
import type { DateKey, Occurrence } from '../domain/types'
import { useHotkeys, useMediaQuery, useSwipe } from '../hooks/hooks'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { setPrefs, usePrefs } from '../state/prefs'
import { setQuery, useRoute } from '../state/router'
import { useUI } from '../state/uiContext'

type View = 'month' | 'week' | 'day'

export function CalendarPage() {
  const { index, today, game } = useAppData()
  const { t, fmt, relative } = useI18n()
  const prefs = usePrefs()
  const route = useRoute()
  const ui = useUI()
  const actions = useOccurrenceActions()
  const narrow = useMediaQuery('(max-width: 720px)')
  const view = (route.query.get('view') as View) || prefs.calendarView
  const qd = route.query.get('d')
  const date = qd && isDateKey(qd) ? qd : today
  const ws = index.settings.weekStartsOn
  const [dragOver, setDragOver] = useState<DateKey | null>(null)

  const setView = (v: View) => {
    setPrefs({ calendarView: v })
    setQuery({ view: v })
  }
  const select = (d: DateKey) => setQuery({ d })

  const step = (dir: 1 | -1) => {
    if (view === 'month') select(addMonths(startOfMonth(date), dir))
    else if (view === 'week') select(addDays(date, 7 * dir))
    else select(addDays(date, dir))
  }
  useHotkeys({ ArrowLeft: () => step(-1), ArrowRight: () => step(1) })
  const swipeRef = useSwipe<HTMLDivElement>(
    () => step(1),
    () => step(-1),
  )

  const range = useMemo(() => {
    if (view === 'month') {
      const first = startOfWeek(startOfMonth(date), ws)
      return { from: first, to: addDays(first, 41) }
    }
    if (view === 'week') {
      const first = startOfWeek(date, ws)
      return { from: first, to: addDays(first, 6) }
    }
    return { from: date, to: date }
  }, [view, date, ws])

  const byDate = useMemo(() => occurrencesByDate(index, range.from, range.to), [index, range])
  const dayOccs = view === 'day' ? (byDate.get(date) ?? []) : (byDate.get(date) ?? occurrencesByDate(index, date, date).get(date) ?? [])

  const onDrop = (e: DragEvent, d: DateKey) => {
    e.preventDefault()
    setDragOver(null)
    const raw = e.dataTransfer.getData('text/momentum-occ')
    if (!raw) return
    const { a, d: orig } = JSON.parse(raw) as { a: string; d: DateKey }
    const occ = getOccurrence(index, a, orig)
    if (occ && occ.date !== d) void actions.move(occ, d)
  }
  const dropProps = (d: DateKey) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes('text/momentum-occ')) {
        e.preventDefault()
        setDragOver(d)
      }
    },
    onDragLeave: () => setDragOver((x) => (x === d ? null : x)),
    onDrop: (e: DragEvent) => onDrop(e, d),
  })

  const weekdays = Array.from({ length: 7 }, (_, i) => weekday(addDays(range.from, i)))
  const title =
    view === 'month'
      ? fmt.monthYear(date)
      : view === 'week'
        ? `${fmt.short(range.from)} – ${fmt.short(range.to)}`
        : fmt.long(date)

  const chip = (o: Occurrence) => {
    const a = index.activityById.get(o.activityId)
    if (!a) return null
    const st = statusOf(o, today)
    return (
      <button
        key={o.key}
        className={`cal-chip status-${st}`}
        style={acStyle(a.color)}
        draggable={!narrow}
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData('text/momentum-occ', JSON.stringify({ a: o.activityId, d: o.originalDate }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={(e) => {
          e.stopPropagation()
          actions.open(o)
        }}
        title={`${a.name}${o.time ? ` · ${o.time}` : ''} – ${t(`status.${st}`)}`}
      >
        <span className="cal-chip-dot" aria-hidden />
        {o.time && <span className="cal-chip-time num">{o.time}</span>}
        <span className="cal-chip-name">{a.name}</span>
      </button>
    )
  }

  return (
    <div className="page calendar-page" ref={swipeRef}>
      <header className="page-head">
        <div>
          <p className="eyebrow">{view === 'week' ? t('calendar.weekLabel', { week: isoWeek(range.from).week }) : t('nav.calendar')}</p>
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label={t('nav.calendar')}>
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {t(`calendar.${v}`)}
              </button>
            ))}
          </div>
          <div className="date-nav">
            <button className="icon-btn bordered" onClick={() => step(-1)} aria-label={t('common.prev')}>
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-sm" onClick={() => select(today)}>
              {t('common.today')}
            </button>
            <button className="icon-btn bordered" onClick={() => step(1)} aria-label={t('common.next')}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </header>

      {view === 'month' && (
        <div className="cal-layout">
          <div className="cal-month surface" role="grid" aria-label={title}>
            <div className="cal-weekdays" role="row">
              {weekdays.map((wd) => (
                <span key={wd} role="columnheader">
                  {fmt.weekdayShort(wd).slice(0, 2)}
                </span>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: 42 }, (_, i) => {
                const d = addDays(range.from, i)
                const occs = byDate.get(d) ?? []
                const s = summarizeDay(d, occs, today)
                const inMonth = parseKey(d).m === parseKey(date).m
                const ratio = s.planned ? s.score / s.planned : 0
                const maxChips = 3
                return (
                  <div
                    key={d}
                    role="gridcell"
                    tabIndex={0}
                    aria-selected={d === date}
                    aria-label={`${fmt.long(d)}: ${t('today.progress', { done: s.done, total: s.planned })}`}
                    className={`cal-cell${inMonth ? '' : ' out'}${d === today ? ' is-today' : ''}${d === date ? ' selected' : ''}${dragOver === d ? ' drag-over' : ''}${d < today && s.planned > 0 && s.done === s.planned ? ' perfect' : ''}`}
                    onClick={() => select(d)}
                    onDoubleClick={() => ui.open({ type: 'editor', date: d })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') select(d)
                    }}
                    {...dropProps(d)}
                  >
                    <div className="cal-cell-head">
                      <span className="cal-num num">{parseKey(d).d}</span>
                      {s.planned > 0 && d <= today && (
                        <ProgressRing value={ratio} size={16} stroke={2.5} color={ratio >= 1 ? 'var(--success)' : 'var(--accent)'} track="var(--border)" />
                      )}
                    </div>
                    {narrow ? (
                      <div className="cal-dots" aria-hidden>
                        {occs.filter(isPlanned).slice(0, 6).map((o) => (
                          <span key={o.key} className={`cal-dot status-${statusOf(o, today)}`} style={acStyle(index.activityById.get(o.activityId)?.color)} />
                        ))}
                      </div>
                    ) : (
                      <div className="cal-chips">
                        {occs.slice(0, maxChips).map(chip)}
                        {occs.length > maxChips && <span className="cal-more">{t('calendar.more', { count: occs.length - maxChips })}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {renderDayPanel(date, dayOccs)}
        </div>
      )}

      {view === 'week' && (
        <div className="cal-week">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(range.from, i)
            const occs = byDate.get(d) ?? []
            const s = summarizeDay(d, occs, today)
            const load = dayLoad(index, d, occs)
            return (
              <section
                key={d}
                className={`cal-week-day surface${d === today ? ' is-today' : ''}${dragOver === d ? ' drag-over' : ''}`}
                {...dropProps(d)}
                aria-label={fmt.long(d)}
              >
                <header>
                  <button className="cal-week-date" onClick={() => setQuery({ view: 'day', d })}>
                    <span className="eyebrow">{fmt.weekdayShort(weekday(d))}</span>
                    <span className="cal-week-num num">{parseKey(d).d}</span>
                  </button>
                  {s.planned > 0 && <span className={`badge ${load.overloaded ? 'warning' : ''}`}>{s.done}/{s.planned}</span>}
                  <button className="icon-btn" onClick={() => ui.open({ type: 'editor', date: d })} aria-label={t('calendar.addHere')}>
                    <Plus size={16} />
                  </button>
                </header>
                <div className="cal-week-list">{occs.length ? occs.map(chip) : <span className="subtle tiny">–</span>}</div>
              </section>
            )
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="cal-day">
          <p className="muted" style={{ marginBottom: 12 }}>{relative(date, today)}</p>
          {dayOccs.length ? (
            <OccurrenceList occurrences={dayOccs} activities={index.activityById} today={today} streaks={game.streaks} onToggle={actions.toggle} onOpen={actions.open} />
          ) : (
            <div className="empty">
              <p>{t('calendar.nothing')}</p>
            </div>
          )}
          <button className="btn" style={{ marginTop: 14 }} onClick={() => ui.open({ type: 'editor', date })}>
            <Plus size={16} /> {t('calendar.addHere')}
          </button>
        </div>
      )}
      {!narrow && view !== 'day' && <p className="subtle tiny" style={{ marginTop: 12 }}>{t('calendar.dragHint')}</p>}
    </div>
  )

  function renderDayPanel(d: DateKey, occs: Occurrence[]) {
    const s = summarizeDay(d, occs, today)
    return (
      <aside className="cal-day-panel surface" aria-label={fmt.long(d)}>
        <header className="cal-day-panel-head">
          <div>
            <p className="eyebrow">{relative(d, today)}</p>
            <h2>{fmt.long(d)}</h2>
          </div>
          <button className="btn btn-sm" onClick={() => ui.open({ type: 'editor', date: d })}>
            <Plus size={15} /> {t('calendar.addHere')}
          </button>
        </header>
        {s.planned > 0 && <p className="subtle small" style={{ margin: '0 0 8px' }}>{t('today.progress', { done: s.done, total: s.planned })}</p>}
        {occs.length ? (
          <OccurrenceList occurrences={occs} activities={index.activityById} today={today} streaks={game.streaks} onToggle={actions.toggle} onOpen={actions.open} grouped={false} compact />
        ) : (
          <p className="subtle small">{t('calendar.nothing')}</p>
        )}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setQuery({ view: 'day', d })}>
          {t('calendar.day')} →
        </button>
      </aside>
    )
  }
}

