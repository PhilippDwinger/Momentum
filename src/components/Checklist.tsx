import { memo } from 'react'
import { ArrowRight, Check, Flame, Lock, Plus, ShieldCheck, SkipForward } from 'lucide-react'
import { parseTime } from '../domain/dates'
import { progressOf, statusOf } from '../domain/occurrences'
import type { StreakInfo } from '../domain/streaks'
import type { Activity, DateKey, Occurrence, OccurrenceStatus } from '../domain/types'
import { useI18n } from '../i18n'
import { ActivityIcon, acStyle } from './Icon'
import { ProgressRing } from './Progress'

interface RowProps {
  occ: Occurrence
  activity: Activity
  today: DateKey
  streak?: StreakInfo
  onToggle: (occ: Occurrence) => void
  onOpen: (occ: Occurrence) => void
  compact?: boolean
  draggable?: boolean
}

export const OccurrenceRow = memo(function OccurrenceRow({ occ, activity, today, streak, onToggle, onOpen, compact, draggable }: RowProps) {
  const { t, fmt, amount } = useI18n()
  const status = statusOf(occ, today)
  const progress = progressOf(occ)
  const future = occ.date > today
  const measurable = activity.kind !== 'check'
  const value = occ.entry?.value ?? 0

  const meta: string[] = []
  if (occ.time) meta.push(occ.time)
  if (measurable) meta.push(value > 0 ? `${fmt.number(value)} / ${amount(activity, occ.target)}` : amount(activity, occ.target))
  else if (activity.durationMinutes) meta.push(`${activity.durationMinutes} ${t('common.min')}`)

  const checkLabel = future
    ? t('occ.futureLocked')
    : measurable
      ? t('occ.log')
      : status === 'done'
        ? t('occ.markUndone')
        : t('occ.markDone')

  return (
    <li
      className={`occ status-${status}${compact ? ' compact' : ''}`}
      style={acStyle(activity.color)}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/momentum-occ', JSON.stringify({ a: occ.activityId, d: occ.originalDate }))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <button className="occ-main" onClick={() => onOpen(occ)} aria-label={`${activity.name} – ${t(`status.${status}`)}`}>
        <ActivityIcon icon={activity.icon} color={activity.color} size={compact ? 'sm' : 'md'} />
        <span className="occ-text">
          <span className="occ-name">{activity.name}</span>
          <span className="occ-meta">
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
            <StatusTag status={status} occ={occ} />
            {streak && streak.current >= 2 && (
              <span className="occ-streak" title={t('detail.current')}>
                <Flame size={13} aria-hidden />
                {streak.current}
              </span>
            )}
          </span>
          {measurable && progress > 0 && progress < 1 && !compact && (
            <span className="occ-progress" aria-hidden>
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </span>
      </button>
      <button
        className={`check ${measurable ? 'measure' : ''}`}
        onClick={() => onToggle(occ)}
        disabled={future || occ.skipped}
        aria-label={`${activity.name}: ${checkLabel}`}
        aria-pressed={measurable ? undefined : status === 'done'}
        title={checkLabel}
      >
        {future ? (
          <Lock size={15} />
        ) : occ.skipped ? (
          <SkipForward size={16} />
        ) : measurable && progress < 1 ? (
          <ProgressRing value={progress} size={compact ? 30 : 36} stroke={3.5} color="var(--ac)">
            <Plus size={15} />
          </ProgressRing>
        ) : (
          <span className="check-box">{status === 'done' && <Check size={compact ? 15 : 18} strokeWidth={3} />}</span>
        )}
      </button>
    </li>
  )
})

function StatusTag({ status, occ }: { status: OccurrenceStatus; occ: Occurrence }) {
  const { t, fmt } = useI18n()
  if (occ.unplanned) return <span className="tag">{t('status.unplanned')}</span>
  return (
    <>
      {occ.moved && (
        <span className="tag">
          <ArrowRight size={11} aria-hidden /> {t('status.movedFrom', { date: fmt.short(occ.originalDate) })}
        </span>
      )}
      {status === 'partial' && <span className="tag warning">{t('status.partial')}</span>}
      {status === 'missed' && <span className="tag missed">{t('status.missed')}</span>}
      {status === 'skipped' && <span className="tag">{t('status.skipped')}</span>}
    </>
  )
}

export function sectionOf(time: string | null): 'morning' | 'midday' | 'evening' | 'anytime' {
  const m = parseTime(time)
  if (m === null) return 'anytime'
  if (m < 11 * 60) return 'morning'
  if (m < 17 * 60) return 'midday'
  return 'evening'
}

interface ListProps {
  occurrences: Occurrence[]
  activities: Map<string, Activity>
  today: DateKey
  streaks?: Map<string, StreakInfo>
  onToggle: (occ: Occurrence) => void
  onOpen: (occ: Occurrence) => void
  grouped?: boolean
  compact?: boolean
  draggable?: boolean
}

export function OccurrenceList({ occurrences, activities, today, streaks, onToggle, onOpen, grouped = true, compact, draggable }: ListProps) {
  const { t } = useI18n()
  const withTime = occurrences.some((o) => o.time)
  const render = (list: Occurrence[]) => (
    <ul className="occ-list">
      {list.map((o) => {
        const a = activities.get(o.activityId)
        if (!a) return null
        return (
          <OccurrenceRow
            key={o.key}
            occ={o}
            activity={a}
            today={today}
            streak={streaks?.get(o.activityId)}
            onToggle={onToggle}
            onOpen={onOpen}
            compact={compact}
            draggable={draggable}
          />
        )
      })}
    </ul>
  )
  if (!grouped || !withTime) return render(occurrences)
  const sections = (['morning', 'midday', 'evening', 'anytime'] as const)
    .map((s) => ({ s, list: occurrences.filter((o) => sectionOf(o.time) === s) }))
    .filter((x) => x.list.length > 0)
  return (
    <div className="occ-sections">
      {sections.map(({ s, list }) => (
        <section key={s} aria-label={t(`today.section.${s}`)}>
          <h3 className="occ-section-title">{t(`today.section.${s}`)}</h3>
          {render(list)}
        </section>
      ))}
    </div>
  )
}

export function ProtectedNote({ date }: { date: DateKey }) {
  const { t, fmt } = useI18n()
  return (
    <span className="badge accent">
      <ShieldCheck size={12} aria-hidden /> {t('detail.protected', { date: fmt.short(date) })}
    </span>
  )
}
