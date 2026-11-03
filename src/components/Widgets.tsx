import { Flame, ShieldCheck, Trophy } from 'lucide-react'
import { addDays, startOfWeek, weekday } from '../domain/dates'
import { challengeProgress } from '../domain/gamification'
import { occurrencesByDate } from '../domain/occurrences'
import { summarizeDay } from '../domain/stats'
import type { DateKey } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { href } from '../state/router'
import { ActivityIcon } from './Icon'
import { Bar, ProgressRing } from './Progress'

export function WeekStrip({ date, onSelect }: { date: DateKey; onSelect: (d: DateKey) => void }) {
  const { index, today } = useAppData()
  const { fmt, relative } = useI18n()
  const start = startOfWeek(date, index.settings.weekStartsOn)
  const end = addDays(start, 6)
  const byDate = occurrencesByDate(index, start, end)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="week-strip" role="tablist" aria-label="Woche">
      {days.map((d) => {
        const s = summarizeDay(d, byDate.get(d) ?? [], today)
        const ratio = s.planned ? s.score / s.planned : 0
        const wd = weekday(d)
        return (
          <button
            key={d}
            role="tab"
            aria-selected={d === date}
            className={`ws-day${d === today ? ' is-today' : ''}${d > today ? ' is-future' : ''}`}
            onClick={() => onSelect(d)}
            aria-label={relative(d, today)}
          >
            <span className="ws-wd">{fmt.weekdayShort(wd).slice(0, 2)}</span>
            <ProgressRing value={ratio} size={34} stroke={3} color={ratio >= 1 ? 'var(--success)' : 'var(--accent)'} track={s.planned ? 'var(--border)' : 'transparent'}>
              <span className="ws-num num">{fmt.day(d)}</span>
            </ProgressRing>
          </button>
        )
      })}
    </div>
  )
}

export function StreakList({ limit = 5 }: { limit?: number }) {
  const { index, game } = useAppData()
  const { t } = useI18n()
  const items = index.activities
    .filter((a) => !a.archivedAt)
    .map((a) => ({ a, s: game.streaks.get(a.id)! }))
    .filter((x) => x.s && x.s.current > 0)
    .sort((x, y) => y.s.current - x.s.current)
    .slice(0, limit)
  if (items.length === 0) return <p className="subtle small">{t('today.noStreaks')}</p>
  return (
    <ul className="streak-list">
      {items.map(({ a, s }) => (
        <li key={a.id}>
          <a href={href(`/activity/${a.id}`)}>
            <ActivityIcon icon={a.icon} color={a.color} size="sm" />
            <span className="streak-name">{a.name}</span>
            {s.currentProtected.length > 0 && <ShieldCheck size={14} className="subtle" aria-label={t('settings.streakProtection')} />}
            <span className={`streak-count${s.atRisk ? ' at-risk' : ''}`} title={t('detail.current')}>
              <Flame size={15} aria-hidden /> {s.current}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function ChallengeList({ week }: { week: DateKey }) {
  const { index, today } = useAppData()
  const { t } = useI18n()
  const list = index.challenges.filter((c) => c.week === week).sort((a, b) => a.type.localeCompare(b.type))
  if (list.length === 0) return <p className="subtle small">{t('today.noChallenges')}</p>
  return (
    <ul className="challenge-list">
      {list.map((c) => {
        const p = challengeProgress(c, index, today)
        const name = c.activityId ? (index.activityById.get(c.activityId)?.name ?? '–') : ''
        return (
          <li key={c.id} className={p.done ? 'done' : ''}>
            <div className="challenge-head">
              <span>{t(`challenge.${c.type}`, { goal: c.goal, name })}</span>
              <span className={`badge ${p.done ? 'success' : ''}`}>
                {p.done ? <Trophy size={12} aria-hidden /> : null}
                {p.done ? t('challenge.done', { xp: c.xp }) : `${p.value}/${p.goal}`}
              </span>
            </div>
            <Bar value={p.value / p.goal} className={p.done ? 'success' : ''} />
          </li>
        )
      })}
    </ul>
  )
}
