import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Copy, Flame, Pause, PencilLine, ShieldCheck, Trash2, Trophy, X } from 'lucide-react'
import { Heatmap } from '../components/Charts'
import { ActivityIcon } from '../components/Icon'
import { useOccurrenceActions } from '../components/useOccurrenceActions'
import { archiveActivity, deleteActivity, duplicateActivity, restoreActivity, setPauses, unarchiveActivity } from '../data/actions'
import { addDays, rangeKeys } from '../domain/dates'
import { activityOccurrences, getOccurrence, isDone, progressOf, statusOf } from '../domain/occurrences'
import { nextScheduledDates } from '../domain/recurrence'
import { activityStats, summarizeDay, type DaySummary } from '../domain/stats'
import type { DateKey } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { href, navigate } from '../state/router'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'

export function ActivityDetailPage({ id }: { id: string }) {
  const { index, today } = useAppData()
  const { t, fmt, describeRule, categoryName, amount } = useI18n()
  const ui = useUI()
  const toast = useToast()
  const actions = useOccurrenceActions()
  const a = index.activityById.get(id)
  const [pauseFrom, setPauseFrom] = useState(today)
  const [pauseTo, setPauseTo] = useState(addDays(today, 7))
  const [showPause, setShowPause] = useState(false)

  const data = useMemo(() => {
    if (!a) return null
    const stats30 = activityStats(index, a, addDays(today, -29), today)
    const allTime = activityStats(index, a, a.startDate, today)
    const from = addDays(today, -7 * 26)
    const occs = activityOccurrences(index, a, from, today)
    const byDate = new Map<DateKey, typeof occs>()
    for (const o of occs) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
    const days = new Map<DateKey, DaySummary>()
    for (const d of rangeKeys(from, today)) days.set(d, summarizeDay(d, byDate.get(d) ?? [], today))
    const log = activityOccurrences(index, a, a.startDate, today)
      .filter((o) => o.entry)
      .reverse()
      .slice(0, 30)
    return { stats30, allTime, days, log, upcoming: nextScheduledDates(a, today, 6) }
  }, [a, index, today])

  if (!a || !data) {
    return (
      <div className="page page-narrow">
        <a className="btn btn-ghost btn-sm" href={href('/activities')}>
          <ArrowLeft size={16} /> {t('activities.title')}
        </a>
        <div className="empty">
          <p>{t('detail.notFound')}</p>
        </div>
      </div>
    )
  }

  const archived = !!a.archivedAt
  const streak = data.allTime.streak
  const current = a.schedule[a.schedule.length - 1]
  const cat = a.categoryId ? index.categoryById.get(a.categoryId) : undefined

  const onDelete = async () => {
    const ok = await ui.confirm({ title: t('common.delete'), message: t('detail.deleteConfirm', { name: a.name }), confirmLabel: t('common.delete'), danger: true })
    if (!ok) return
    const entries = index.entriesByActivity.get(a.id) ?? []
    const overrides = [...index.overrides.values()].filter((o) => o.activityId === a.id)
    await deleteActivity(a)
    navigate('/activities')
    toast({ message: t('detail.deleted', { name: a.name }), action: { label: t('common.undo'), run: () => void restoreActivity({ activity: a, entries, overrides }) } })
  }

  const kpi = (label: string, value: string, extra?: string) => (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      {extra && <span className="kpi-extra">{extra}</span>}
    </div>
  )

  return (
    <div className="page page-narrow">
      <a className="btn btn-ghost btn-sm back-link" href={href('/activities')}>
        <ArrowLeft size={16} /> {t('activities.title')}
      </a>
      <header className="detail-head">
        <ActivityIcon icon={a.icon} color={a.color} size="xl" />
        <div className="detail-title">
          <h1 className="page-title">{a.name}</h1>
          <p className="muted">
            {describeRule(current.rule, current.from)}
            {a.kind !== 'check' && ` · ${amount(a, current.target)}`}
            {a.time && ` · ${a.time}`}
          </p>
          <div className="chips" style={{ marginTop: 8 }}>
            {cat && <span className="badge">{categoryName(cat)}</span>}
            <span className="badge">{t('detail.since', { date: fmt.short(a.startDate) })}</span>
            {a.endDate && <span className="badge">{t('detail.until', { date: fmt.short(a.endDate) })}</span>}
            {archived && <span className="badge warning">{t('activities.archived')}</span>}
          </div>
        </div>
        <div className="page-actions detail-actions">
          <button className="btn btn-primary" onClick={() => ui.open({ type: 'editor', activityId: a.id })}>
            <PencilLine size={16} /> {t('common.edit')}
          </button>
          {archived ? (
            <button className="btn" onClick={() => void unarchiveActivity(a, today)}>
              <ArchiveRestore size={16} /> {t('detail.unarchive')}
            </button>
          ) : (
            <button
              className="btn"
              onClick={async () => {
                await archiveActivity(a, today, index)
                toast({ message: t('detail.archivedToast', { name: a.name }) })
              }}
            >
              <Archive size={16} /> {t('detail.archive')}
            </button>
          )}
          <button className="icon-btn bordered" title={t('detail.duplicate')} aria-label={t('detail.duplicate')} onClick={async () => {
            const copy = await duplicateActivity(a, today, index)
            navigate(`/activity/${copy.id}`)
          }}>
            <Copy size={16} />
          </button>
          <button className="icon-btn bordered" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => void onDelete()}>
            <Trash2 size={16} color="var(--danger)" />
          </button>
        </div>
      </header>

      {archived && <p className="hint small">{t('detail.archivedSince', { date: fmt.long(a.archivedAt!) })}</p>}
      {a.description && <p className="muted" style={{ marginBottom: 16 }}>{a.description}</p>}

      <div className="kpi-row">
        {kpi(t('detail.rate'), fmt.percent(data.stats30.totals.rate), data.stats30.totals.evaluated ? `${data.stats30.totals.done}/${data.stats30.totals.evaluated}` : undefined)}
        <div className="kpi">
          <span className="kpi-label">{t('detail.current')}</span>
          <span className="kpi-value num">
            <Flame size={20} color="var(--accent)" aria-hidden /> {streak.current}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{t('detail.longest')}</span>
          <span className="kpi-value num">
            <Trophy size={18} color="var(--c-amber)" aria-hidden /> {streak.longest}
          </span>
        </div>
        {kpi(t('detail.total'), String(streak.totalSuccess), data.allTime.avgValue !== null ? `${t('detail.avg')}: ${amount(a, Math.round(data.allTime.avgValue * 10) / 10)}` : undefined)}
      </div>

      {streak.currentProtected.length > 0 && (
        <p className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <ShieldCheck size={15} aria-hidden /> {t('detail.protected', { date: streak.currentProtected.map(fmt.short).join(', ') })}
        </p>
      )}

      <section className="section">
        <h2 className="section-title">{t('detail.log')}</h2>
        <div className="surface panel">
          <Heatmap days={data.days} today={today} weeks={26} weekStartsOn={index.settings.weekStartsOn} onSelect={(d) => {
            const occ = getOccurrence(index, a.id, d)
            if (occ) actions.open(occ)
          }} />
        </div>
      </section>

      <div className="detail-columns">
        <section className="section">
          <h2 className="section-title">{t('detail.upcoming')}</h2>
          {data.upcoming.length === 0 ? (
            <p className="subtle small">{t('editor.noUpcoming')}</p>
          ) : (
            <ul className="mini-list surface">
              {data.upcoming.map((d) => {
                const occ = getOccurrence(index, a.id, d)
                return (
                  <li key={d}>
                    <button onClick={() => occ && actions.open(occ)}>
                      <span>{d === today ? t('common.today') : fmt.medium(d)}</span>
                      {occ && <span className={`badge ${isDone(occ) ? 'success' : ''}`}>{t(`status.${statusOf(occ, today)}`)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="section">
          <h2 className="section-title">{a.schedule.length > 1 ? t('detail.history') : t('detail.plan')}</h2>
          <ul className="mini-list surface">
            {a.schedule.map((s, i) => (
              <li key={s.from + i}>
                <div className="mini-row">
                  <span>{describeRule(s.rule, s.from)}{a.kind !== 'check' ? ` · ${amount(a, s.target)}` : ''}</span>
                  <span className="subtle tiny">{t('detail.since', { date: fmt.short(s.from) })}</span>
                </div>
              </li>
            ))}
          </ul>
          <h3 className="field-label" style={{ margin: '16px 0 8px' }}>{t('detail.pauses')}</h3>
          <p className="field-hint" style={{ marginBottom: 8 }}>{t('detail.pauseHint')}</p>
          {a.pauses.length > 0 && (
            <ul className="mini-list surface" style={{ marginBottom: 8 }}>
              {a.pauses.map((p, i) => (
                <li key={i}>
                  <div className="mini-row">
                    <span>
                      {fmt.short(p.from)} – {fmt.short(p.to)}
                    </span>
                    <button className="icon-btn" aria-label={t('common.delete')} onClick={() => void setPauses(a, a.pauses.filter((_, j) => j !== i))}>
                      <X size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showPause ? (
            <div className="pause-form">
              <input className="input" type="date" value={pauseFrom} onChange={(e) => setPauseFrom(e.target.value)} aria-label={t('editor.startDate')} />
              <input className="input" type="date" value={pauseTo} min={pauseFrom} onChange={(e) => setPauseTo(e.target.value)} aria-label={t('editor.endDate')} />
              <button
                className="btn btn-sm btn-primary"
                disabled={!pauseFrom || !pauseTo || pauseTo < pauseFrom}
                onClick={async () => {
                  await setPauses(a, [...a.pauses, { from: pauseFrom, to: pauseTo }])
                  setShowPause(false)
                }}
              >
                {t('common.add')}
              </button>
            </div>
          ) : (
            <button className="btn btn-sm" onClick={() => setShowPause(true)}>
              <Pause size={14} /> {t('detail.pause')}
            </button>
          )}
        </section>
      </div>

      <section className="section">
        <h2 className="section-title">{t('occ.note')} & {t('detail.log')}</h2>
        {data.log.length === 0 ? (
          <p className="subtle small">{t('detail.noLog')}</p>
        ) : (
          <ul className="log-list surface">
            {data.log.map((o) => (
              <li key={o.key}>
                <button onClick={() => actions.open(o)}>
                  <span className="log-date">{fmt.medium(o.date)}</span>
                  <span className="log-body">
                    <span className={`badge ${isDone(o) ? 'success' : progressOf(o) > 0 ? 'warning' : ''}`}>
                      {a.kind === 'check' ? t(`status.${statusOf(o, today)}`) : `${fmt.number(o.entry?.value ?? 0)} / ${amount(a, o.target)}`}
                    </span>
                    {o.entry?.note && <span className="log-note">{o.entry.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {a.notes && (
        <section className="section">
          <h2 className="section-title">{t('editor.notes')}</h2>
          <p className="surface panel notes-text">{a.notes}</p>
        </section>
      )}
    </div>
  )
}
