import { useMemo, useState } from 'react'
import { BarChart3, Download, Flame } from 'lucide-react'
import { BarChart, Heatmap, LineChart, RateRows } from '../components/Charts'
import { ActivityIcon, colorVar } from '../components/Icon'
import { dailyCsv, downloadFile } from '../data/exportImport'
import { addDays, rangeKeys, startOfWeek } from '../domain/dates'
import { activityStats, daySummaries, earliestStart, filterActivities, monthlyBuckets, totalsOf, weekdayPattern, weeklyBuckets } from '../domain/stats'
import type { ID } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { setPrefs, usePrefs, type Prefs } from '../state/prefs'
import { href, navigate } from '../state/router'

const RANGES: Prefs['statsRange'][] = ['7', '30', '90', '365', 'all']

export function StatsPage() {
  const { index, today } = useAppData()
  const { t, fmt, categoryName } = useI18n()
  const prefs = usePrefs()
  const range = prefs.statsRange
  const [categoryId, setCategoryId] = useState<ID | ''>('')
  const [activityId, setActivityId] = useState<ID | ''>('')
  const ws = index.settings.weekStartsOn

  const acts = useMemo(() => filterActivities(index, { categoryId: categoryId || null, activityId: activityId || null }), [index, categoryId, activityId])
  const from = range === 'all' ? earliestStart(index, today) : addDays(today, -(Number(range) - 1))

  const s = useMemo(() => {
    const heatFrom = addDays(startOfWeek(today, ws), -7 * 52)
    const spanFrom = from < heatFrom ? from : heatFrom
    const days = daySummaries(index, spanFrom, today, today, acts)
    const inRange = rangeKeys(from, today).map((d) => days.get(d)!).filter(Boolean)
    const totals = totalsOf(inRange, today)
    const perActivity = acts.map((a) => activityStats(index, a, from, today)).sort((x, y) => (y.totals.rate ?? -1) - (x.totals.rate ?? -1))
    const weeks = weeklyBuckets(index, 12, today, ws, acts)
    const months = monthlyBuckets(index, 12, today, acts)
    const pattern = weekdayPattern(inRange, today)
    const byCategory = index.categories
      .map((c) => {
        const list = acts.filter((a) => a.categoryId === c.id)
        if (list.length === 0) return null
        const own = daySummaries(index, from, today, today, list)
        return { c, totals: totalsOf(own.values(), today) }
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.totals.evaluated > 0)
    let total = 0
    for (const e of index.entries.values()) if (acts.some((a) => a.id === e.activityId) && e.value >= (e.target || 1)) total++
    const bestCurrent = perActivity.reduce((m, x) => Math.max(m, x.streak.current), 0)
    const longest = perActivity.reduce((m, x) => Math.max(m, x.streak.longest), 0)
    return { days, inRange, totals, perActivity, weeks, months, pattern, byCategory, total, bestCurrent, longest }
  }, [index, acts, from, today, ws])

  const pct = (v: number | null) => fmt.percent(v)
  const hasData = s.totals.evaluated > 0 || s.total > 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('stats.rateNote')}</p>
          <h1 className="page-title">{t('stats.title')}</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => downloadFile(`momentum-stats-${today}.csv`, dailyCsv(s.inRange), 'text/csv')} disabled={!hasData}>
            <Download size={15} /> {t('stats.exportCsv')}
          </button>
        </div>
      </header>

      <div className="filter-row stats-filters">
        <div className="seg" role="group" aria-label="Zeitraum">
          {RANGES.map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setPrefs({ statsRange: r })}>
              {t(`stats.range.${r}`)}
            </button>
          ))}
        </div>
        <select className="select select-sm" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setActivityId('') }} aria-label={t('editor.category')}>
          <option value="">{t('activities.filter.allCategories')}</option>
          {index.categories.map((c) => (
            <option key={c.id} value={c.id}>{categoryName(c)}</option>
          ))}
        </select>
        <select className="select select-sm" value={activityId} onChange={(e) => setActivityId(e.target.value)} aria-label={t('stats.col.activity')}>
          <option value="">{t('stats.allActivities')}</option>
          {index.activities.filter((a) => !categoryId || a.categoryId === categoryId).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {!hasData ? (
        <div className="empty surface">
          <div className="empty-icon"><BarChart3 size={26} /></div>
          <p>{t('stats.empty')}</p>
        </div>
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span className="kpi-label">{t('stats.rate')}</span>
              <span className="kpi-value num">{pct(s.totals.rate)}</span>
              <span className="kpi-extra">{t('stats.rateDetail', { done: s.totals.done, planned: s.totals.evaluated })}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t('stats.total')}</span>
              <span className="kpi-value num">{s.total}</span>
              <span className="kpi-extra">{t('stats.totalDetail')}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t('stats.currentStreak')}</span>
              <span className="kpi-value num"><Flame size={20} color="var(--accent)" aria-hidden /> {s.bestCurrent}</span>
              <span className="kpi-extra">{t('stats.longestStreak')}: {s.longest}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t('stats.perfectDays')}</span>
              <span className="kpi-value num">{s.totals.perfectDays}</span>
              <span className="kpi-extra">{t('stats.perfectDetail', { days: s.totals.daysWithPlan })}</span>
            </div>
          </div>

          <section className="section">
            <h2 className="section-title">{t('stats.heatmap')}</h2>
            <div className="surface panel">
              <Heatmap days={s.days} today={today} weekStartsOn={ws} onSelect={(d) => navigate(`/today?d=${d}`)} />
            </div>
          </section>

          <div className="stats-grid">
            <section className="surface panel">
              <h2 className="panel-title">{t('stats.weekly')}</h2>
              <BarChart
                format={pct}
                data={s.weeks.map((b, i) => ({
                  key: b.start,
                  label: fmt.numeric(b.start),
                  value: b.totals.rate,
                  detail: t('stats.rateDetail', { done: b.totals.done, planned: b.totals.evaluated }),
                  highlight: i === s.weeks.length - 1,
                }))}
              />
            </section>
            <section className="surface panel">
              <h2 className="panel-title">{t('stats.monthly')}</h2>
              <LineChart
                format={pct}
                data={s.months.map((b) => ({
                  key: b.start,
                  label: fmt.monthShort(b.start),
                  value: b.totals.rate,
                  detail: t('stats.rateDetail', { done: b.totals.done, planned: b.totals.evaluated }),
                }))}
              />
            </section>
            <section className="surface panel">
              <h2 className="panel-title">{t('stats.weekdays')}</h2>
              <RateRows
                format={pct}
                rows={s.pattern.map((p) => ({ key: String(p.weekday), label: fmt.weekdayShort(p.weekday), value: p.rate, detail: `${p.evaluated}` }))}
              />
            </section>
            {s.byCategory.length > 0 && !activityId && (
              <section className="surface panel">
                <h2 className="panel-title">{t('stats.byCategory')}</h2>
                <RateRows
                  format={pct}
                  rows={s.byCategory.map(({ c, totals }) => ({
                    key: c.id,
                    label: categoryName(c),
                    value: totals.rate,
                    color: colorVar(c.color),
                    detail: t('stats.rateDetail', { done: totals.done, planned: totals.evaluated }),
                  }))}
                />
              </section>
            )}
          </div>

          <section className="section">
            <h2 className="section-title">{t('stats.byActivity')}</h2>
            <div className="table-wrap surface">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('stats.col.activity')}</th>
                    <th scope="col" className="r">{t('stats.col.rate')}</th>
                    <th scope="col" className="r">{t('stats.col.done')}</th>
                    <th scope="col" className="r hide-mobile">{t('stats.col.perWeek')}</th>
                    <th scope="col" className="r">{t('stats.col.streak')}</th>
                    <th scope="col" className="r hide-mobile">{t('stats.col.best')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perActivity.map((x) => (
                    <tr key={x.activity.id}>
                      <td>
                        <a href={href(`/activity/${x.activity.id}`)} className="table-activity">
                          <ActivityIcon icon={x.activity.icon} color={x.activity.color} size="sm" />
                          <span>{x.activity.name}</span>
                        </a>
                      </td>
                      <td className="r num">
                        <span className="rate-cell">
                          <span className="rate-mini"><span style={{ width: `${(x.totals.rate ?? 0) * 100}%`, background: colorVar(x.activity.color) }} /></span>
                          {pct(x.totals.rate)}
                        </span>
                      </td>
                      <td className="r num">{x.totals.done}/{x.totals.evaluated}</td>
                      <td className="r num hide-mobile">{fmt.number(Math.round(x.perWeek * 10) / 10)}</td>
                      <td className="r num">{x.streak.current}</td>
                      <td className="r num hide-mobile">{x.streak.longest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
