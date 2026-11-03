import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Compass, Minus, Sparkles, TrendingUp, TriangleAlert, Trophy } from 'lucide-react'
import { ActivityIcon } from '../components/Icon'
import { Bar } from '../components/Progress'
import { addDays, isDateKey, isoWeek, startOfWeek, weekday } from '../domain/dates'
import { buildWeeklyReview } from '../domain/review'
import { useHotkeys } from '../hooks/hooks'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { href, setQuery, useRoute } from '../state/router'

export function ReviewPage() {
  const { index, today } = useAppData()
  const { t, fmt } = useI18n()
  const route = useRoute()
  const qw = route.query.get('w')
  const current = startOfWeek(today, 1)
  const week = qw && isDateKey(qw) ? startOfWeek(qw, 1) : current
  const r = useMemo(() => buildWeeklyReview(index, week, today), [index, week, today])
  const go = (w: string) => setQuery({ w: w === current ? null : w })
  useHotkeys({ ArrowLeft: () => go(addDays(week, -7)), ArrowRight: () => week < current && go(addDays(week, 7)) })
  const pct = fmt.percent
  const wk = isoWeek(week).week

  const delta = r.rateDelta === null ? null : Math.round(r.rateDelta * 100)
  const highlights: { icon: typeof Trophy; text: string }[] = []
  if (r.perfectDays.length) highlights.push({ icon: Sparkles, text: t('review.perfectDays', { count: r.perfectDays.length, days: r.perfectDays.map((d) => fmt.weekdayShort(weekday(d))).join(', ') }) })
  for (const x of r.activities.filter((x) => x.planned >= 2 && x.done === x.planned)) highlights.push({ icon: Trophy, text: t('review.fullActivity', { name: x.activity.name, count: x.planned }) })
  if (r.bestWeekday) highlights.push({ icon: TrendingUp, text: t('review.bestDay', { day: fmt.weekdayLong(r.bestWeekday) }) })

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <p className="eyebrow">{r.isCurrent ? t('review.current') : t('calendar.weekLabel', { week: wk })}</p>
          <h1 className="page-title">{t('review.title')}</h1>
        </div>
        <div className="date-nav">
          <button className="icon-btn bordered" onClick={() => go(addDays(week, -7))} aria-label={t('common.prev')}>
            <ChevronLeft size={18} />
          </button>
          <span className="week-label num">{t('review.week', { week: wk, range: `${fmt.short(week)} – ${fmt.short(r.weekEnd)}` })}</span>
          <button className="icon-btn bordered" onClick={() => go(addDays(week, 7))} disabled={week >= current} aria-label={t('common.next')}>
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {!r.hasData ? (
        <div className="empty surface">
          <p>{t('review.noData')}</p>
        </div>
      ) : (
        <>
          <section className="review-summary surface">
            <p className="review-lead display">
              {r.totals.evaluated > 0
                ? t('review.summary', { done: r.totals.done, planned: r.totals.evaluated, rate: pct(r.totals.rate) })
                : t('review.summaryNone')}
            </p>
            {delta !== null && (
              <p className="review-delta">
                {delta > 0 ? <ArrowUpRight size={18} color="var(--success)" /> : delta < 0 ? <ArrowDownRight size={18} color="var(--warning)" /> : <Minus size={18} />}
                {delta > 0 ? t('review.better', { delta }) : delta < 0 ? t('review.worse', { delta: Math.abs(delta) }) : t('review.same')}
              </p>
            )}
            <div className="compare">
              <div>
                <span className="kpi-label">{t('review.thisWeek')}</span>
                <span className="kpi-value num">{pct(r.totals.rate)}</span>
                <Bar value={r.totals.rate ?? 0} />
                <span className="subtle tiny">{r.totals.done}/{r.totals.evaluated}</span>
              </div>
              <div>
                <span className="kpi-label">{t('review.lastWeek')}</span>
                <span className="kpi-value num subtle">{pct(r.prevTotals.rate)}</span>
                <Bar value={r.prevTotals.rate ?? 0} color="var(--text-3)" />
                <span className="subtle tiny">{r.prevTotals.done}/{r.prevTotals.evaluated}</span>
              </div>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title"><Sparkles size={18} color="var(--accent)" aria-hidden /> {t('review.wentWell')}</h2>
            {highlights.length ? (
              <ul className="review-list">
                {highlights.map((h, i) => (
                  <li key={i}><h.icon size={16} aria-hidden /> {h.text}</li>
                ))}
              </ul>
            ) : (
              <p className="subtle">{t('review.nothingYet')}</p>
            )}
          </section>

          {r.consistent.length > 0 && (
            <section className="section">
              <h2 className="section-title"><Trophy size={18} color="var(--c-amber)" aria-hidden /> {t('review.consistent')}</h2>
              <ul className="mini-list surface">
                {r.consistent.map((x) => (
                  <li key={x.activity.id}>
                    <a className="mini-row" href={href(`/activity/${x.activity.id}`)}>
                      <span className="mini-activity"><ActivityIcon icon={x.activity.icon} color={x.activity.color} size="sm" /> {x.activity.name}</span>
                      <span className="badge success">{pct(x.rate)} · {x.done}/{x.planned}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section">
            <h2 className="section-title"><TriangleAlert size={18} color="var(--warning)" aria-hidden /> {t('review.missed')}</h2>
            {r.missed.length === 0 ? (
              <p className="subtle">{t('review.noMissed')}</p>
            ) : (
              <ul className="mini-list surface">
                {r.missed.map((x) => (
                  <li key={x.activity.id}>
                    <a className="mini-row" href={href(`/activity/${x.activity.id}`)}>
                      <span className="mini-activity"><ActivityIcon icon={x.activity.icon} color={x.activity.color} size="sm" /> {x.activity.name}</span>
                      <span className="subtle small">{t('review.missedItem', { count: x.missedDates.length, days: x.missedDates.map(fmt.short).join(', ') })}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section">
            <h2 className="section-title"><TrendingUp size={18} color="var(--success)" aria-hidden /> {t('review.improving')}</h2>
            {r.improving.length === 0 ? (
              <p className="subtle">{t('review.noImproving')}</p>
            ) : (
              <ul className="mini-list surface">
                {r.improving.map((x) => (
                  <li key={x.activity.id}>
                    <div className="mini-row">
                      <span className="mini-activity"><ActivityIcon icon={x.activity.icon} color={x.activity.color} size="sm" /> {x.activity.name}</span>
                      <span className="subtle small">{t('review.improvingItem', { rate: pct(x.rate), prev: pct(x.prevAvg) })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {r.focus && (
            <section className="section">
              <h2 className="section-title"><Compass size={18} aria-hidden /> {t('review.focus')}</h2>
              <p className="hint">{t(`review.focus.${r.focus.kind}`, { name: r.focus.activity.name })}</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
