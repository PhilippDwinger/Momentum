import { useEffect, useMemo } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Lightbulb, Plus, Sparkles, Sprout, Wand2 } from 'lucide-react'
import { OccurrenceList } from '../components/Checklist'
import { ProgressRing } from '../components/Progress'
import { useOccurrenceActions } from '../components/useOccurrenceActions'
import { ChallengeList, StreakList, WeekStrip } from '../components/Widgets'
import { addDays, isDateKey, startOfWeek, zonedParts } from '../domain/dates'
import { motivationFor } from '../domain/motivation'
import { getOccurrence, isDone, isPlanned, occurrencesOn } from '../domain/occurrences'
import { dayLoad, suggestRelief } from '../domain/scheduling'
import { summarizeDay } from '../domain/stats'
import { useHotkeys, useSwipe } from '../hooks/hooks'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { setQuery, useRoute } from '../state/router'
import { useUI } from '../state/uiContext'

function greetingKey(hour: number) {
  if (hour < 5) return 'greet.night'
  if (hour < 11) return 'greet.morning'
  if (hour < 18) return 'greet.day'
  if (hour < 22) return 'greet.evening'
  return 'greet.night'
}

export function TodayPage() {
  const { index, today, game, timeZone } = useAppData()
  const { t, fmt, relative } = useI18n()
  const ui = useUI()
  const route = useRoute()
  const actions = useOccurrenceActions()
  const doneKey = route.query.get('done')
  useEffect(() => {
    if (!doneKey) return
    setQuery({ done: null })
    const i = doneKey.lastIndexOf('_')
    const occ = i > 0 ? getOccurrence(index, doneKey.slice(0, i), doneKey.slice(i + 1)) : null
    if (occ && !isDone(occ) && occ.date <= today) void actions.toggle(occ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey])
  const qd = route.query.get('d')
  const date = qd && isDateKey(qd) ? qd : today
  const go = (d: string) => setQuery({ d: d === today ? null : d })

  const occs = useMemo(() => occurrencesOn(index, date), [index, date])
  const summary = summarizeDay(date, occs, today)
  const planned = occs.filter(isPlanned)
  const doneCount = summary.done
  const ratio = summary.planned ? summary.score / summary.planned : 0
  const allDone = summary.planned > 0 && doneCount === summary.planned
  const load = dayLoad(index, date, occs)
  const relief = load.overloaded ? suggestRelief(index, date, today) : null
  const motivation = motivationFor(index, date, today, occs, game.streaks)
  const isToday = date === today

  const swipeRef = useSwipe<HTMLDivElement>(
    () => go(addDays(date, 1)),
    () => go(addDays(date, -1)),
  )
  useHotkeys({
    ArrowLeft: () => go(addDays(date, -1)),
    ArrowRight: () => go(addDays(date, 1)),
  })

  const name = index.settings.name.trim()
  const heading = isToday ? `${t(greetingKey(zonedParts(new Date(), timeZone).hour))}${name ? `, ${name}` : ''}` : relative(date, today)
  const noActivities = index.activities.length === 0

  return (
    <div className="page" ref={swipeRef}>
      <header className="today-head">
        <div>
          <p className="eyebrow">{fmt.longYear(date)}</p>
          <h1 className="page-title">{heading}</h1>
        </div>
        <div className="date-nav">
          <button className="icon-btn bordered nav-step" onClick={() => go(addDays(date, -1))} aria-label={t('common.prev')} title="←">
            <ChevronLeft size={18} />
          </button>
          <button className="btn btn-sm" onClick={() => go(today)} disabled={isToday}>
            {t('common.today')}
          </button>
          <button className="icon-btn bordered nav-step" onClick={() => go(addDays(date, 1))} aria-label={t('common.next')} title="→">
            <ChevronRight size={18} />
          </button>
          <label className="icon-btn bordered date-pick" title={t('activities.filter.date')}>
            <CalendarDays size={18} aria-hidden />
            <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('activities.filter.date')} />
          </label>
        </div>
      </header>

      <WeekStrip date={date} onSelect={go} />

      <div className="today-grid">
        <div className="today-main">
          {noActivities ? (
            <section className="surface welcome">
              <div className="welcome-art" aria-hidden>
                <Sprout size={30} />
              </div>
              <h2 className="display">{t('today.welcomeTitle')}</h2>
              <p className="muted">{t('today.welcomeText')}</p>
              <div className="actions">
                <button className="btn btn-primary btn-lg" onClick={() => ui.open({ type: 'editor', date })}>
                  <Plus size={18} /> {t('today.firstActivity')}
                </button>
                <button className="btn btn-lg" onClick={() => ui.open({ type: 'templates' })}>
                  <Wand2 size={18} /> {t('today.useTemplate')}
                </button>
              </div>
            </section>
          ) : (
            <>
              {summary.planned > 0 && (
                <section className={`day-progress surface${allDone ? ' all-done' : ''}`} aria-live="polite">
                  <ProgressRing value={ratio} size={76} stroke={7} color={allDone ? 'var(--success)' : 'var(--accent)'} label={t('today.progress', { done: doneCount, total: summary.planned })}>
                    {allDone ? <Check className="done-check" size={30} strokeWidth={3} /> : <span className="ring-pct num">{Math.round(ratio * 100)}%</span>}
                  </ProgressRing>
                  <div className="day-progress-text">
                    <h2>{allDone ? t('today.allDoneTitle') : t('today.progress', { done: doneCount, total: summary.planned })}</h2>
                    <p className="muted small">
                      {allDone ? t('today.allDoneText') : date > today ? t('today.futureHint') : date < today ? t('today.pastHint') : index.settings.showMotivation ? t(motivation.key, motivation.params) : ''}
                    </p>
                  </div>
                  {isToday && game.xpToday > 0 && <span className="badge accent xp-badge">{t('today.xpToday', { xp: game.xpToday })}</span>}
                  {allDone && <Sparkles className="sparkle" size={18} aria-hidden />}
                </section>
              )}

              {load.overloaded && (
                <div className="hint" role="note">
                  <Lightbulb size={18} aria-hidden />
                  <div>
                    <p>{load.count > (index.settings.overloadThreshold || 5) ? t('today.overload', { count: load.count }) : t('today.overloadMinutes', { minutes: load.minutes })}</p>
                    {relief ? (
                      <p className="small muted">
                        {t('today.overloadSuggest', {
                          name: index.activityById.get(relief.occurrence.activityId)?.name ?? '',
                          date: fmt.medium(relief.to),
                          from: relief.fromCount,
                          to: relief.toCount + 1,
                        })}
                      </p>
                    ) : (
                      <p className="small muted">{t('today.overloadNoSuggest')}</p>
                    )}
                  </div>
                  {relief && (
                    <button className="btn btn-sm" onClick={() => void actions.move(relief.occurrence, relief.to)}>
                      {t('today.overloadApply')}
                    </button>
                  )}
                </div>
              )}

              {occs.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">
                    <Sprout size={26} />
                  </div>
                  <h3>{t('today.restTitle')}</h3>
                  <p>{t('today.restText')}</p>
                  <div className="actions">
                    <button className="btn" onClick={() => ui.open({ type: 'editor', date })}>
                      <Plus size={16} /> {t('calendar.addHere')}
                    </button>
                  </div>
                </div>
              ) : (
                <OccurrenceList
                  occurrences={occs}
                  activities={index.activityById}
                  today={today}
                  streaks={game.streaks}
                  onToggle={actions.toggle}
                  onOpen={actions.open}
                />
              )}
              {planned.length > 0 && (
                <button className="btn btn-ghost btn-sm add-inline" onClick={() => ui.open({ type: 'editor', date })}>
                  <Plus size={16} /> {t('calendar.addHere')}
                </button>
              )}
            </>
          )}
        </div>

        {!noActivities && (
          <aside className="today-aside">
            {index.settings.showMotivation && isToday && summary.planned > 0 && !allDone && (
              <section className="panel surface quote">
                <p>{t(motivationFor(index, addDays(today, 1), today, [], game.streaks).key)}</p>
              </section>
            )}
            <section className="panel surface">
              <h2 className="panel-title">{t('today.streaks')}</h2>
              <StreakList />
            </section>
            <section className="panel surface">
              <h2 className="panel-title">{t('today.challenges')}</h2>
              <ChallengeList week={startOfWeek(today, 1)} />
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}
