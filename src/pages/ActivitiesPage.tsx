import { useMemo, useRef, useState } from 'react'
import { Archive, Flame, FolderCog, Plus, Search, Wand2, X } from 'lucide-react'
import { ActivityIcon, acStyle } from '../components/Icon'
import { addDays, isDateKey } from '../domain/dates'
import { activityOccurrences, isDone, isPlanned, occurrencesOn } from '../domain/occurrences'
import { isOneTime, isScheduled, nextScheduledDates, segmentFor } from '../domain/recurrence'
import type { Activity } from '../domain/types'
import { useHotkeys } from '../hooks/hooks'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { href, setQuery, useRoute } from '../state/router'
import { useUI } from '../state/uiContext'

type StatusFilter = 'active' | 'archived' | 'all'
type StateFilter = '' | 'openToday' | 'doneToday' | 'onStreak' | 'missedRecently'
type RecFilter = '' | 'recurring' | 'oneTime'

export function ActivitiesPage() {
  const { index, today, game } = useAppData()
  const { t, fmt, describeRule, categoryName, amount } = useI18n()
  const ui = useUI()
  const route = useRoute()
  const q = route.query
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState(q.get('q') ?? '')
  const status = (q.get('status') as StatusFilter) || 'active'
  const category = q.get('cat') ?? ''
  const rec = (q.get('rec') as RecFilter) || ''
  const state = (q.get('state') as StateFilter) || ''
  const onDate = q.get('date') ?? ''
  useHotkeys({ '/': () => searchRef.current?.focus() })

  const todayOccs = useMemo(() => occurrencesOn(index, today), [index, today])
  const recentMissed = useMemo(() => {
    const set = new Set<string>()
    for (const a of index.activities) {
      const occs = activityOccurrences(index, a, addDays(today, -7), addDays(today, -1))
      if (occs.some((o) => isPlanned(o) && !isDone(o))) set.add(a.id)
    }
    return set
  }, [index, today])

  const list = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return index.activities.filter((a) => {
      const archived = !!a.archivedAt
      if (status === 'active' && archived) return false
      if (status === 'archived' && !archived) return false
      if (category && (category === 'none' ? a.categoryId !== null : a.categoryId !== category)) return false
      if (rec === 'recurring' && isOneTime(a)) return false
      if (rec === 'oneTime' && !isOneTime(a)) return false
      if (onDate && isDateKey(onDate) && !isScheduled(a, onDate)) return false
      if (state) {
        const occ = todayOccs.find((o) => o.activityId === a.id && isPlanned(o))
        if (state === 'openToday' && (!occ || isDone(occ))) return false
        if (state === 'doneToday' && (!occ || !isDone(occ))) return false
        if (state === 'onStreak' && (game.streaks.get(a.id)?.current ?? 0) < 1) return false
        if (state === 'missedRecently' && !recentMissed.has(a.id)) return false
      }
      if (needle) {
        const hay = `${a.name} ${a.description} ${a.notes} ${categoryName(index.categoryById.get(a.categoryId ?? ''))}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [index, search, status, category, rec, state, onDate, today, todayOccs, game, recentMissed, categoryName])

  const filtersActive = !!(search || status !== 'active' || category || rec || state || onDate)
  const clear = () => {
    setSearch('')
    setQuery({ q: null, status: null, cat: null, rec: null, state: null, date: null })
  }

  const row = (a: Activity) => {
    const seg = segmentFor(a, today < a.startDate ? a.startDate : today) ?? a.schedule[a.schedule.length - 1]
    const streak = game.streaks.get(a.id)
    const next = nextScheduledDates(a, today, 1)[0]
    const archived = !!a.archivedAt
    const ended = !archived && a.endDate && a.endDate < today
    return (
      <li key={a.id}>
        <a className="activity-row" href={href(`/activity/${a.id}`)} style={acStyle(a.color)}>
          <ActivityIcon icon={a.icon} color={a.color} />
          <span className="activity-row-text">
            <span className="activity-row-name">
              {a.name}
              {archived && <span className="badge"><Archive size={11} aria-hidden /> {t('activities.archived')}</span>}
              {ended && <span className="badge">{t('activities.ended')}</span>}
            </span>
            <span className="activity-row-meta">
              {describeRule(seg.rule, seg.from)}
              {a.kind !== 'check' && ` · ${amount(a, seg.target)}`}
              {a.time && ` · ${a.time}`}
              {a.categoryId && index.categoryById.get(a.categoryId) && ` · ${categoryName(index.categoryById.get(a.categoryId))}`}
            </span>
          </span>
          <span className="activity-row-side">
            {streak && streak.current > 0 && (
              <span className="streak-count" title={t('detail.current')}>
                <Flame size={14} aria-hidden /> {streak.current}
              </span>
            )}
            {!archived && next && <span className="subtle tiny hide-mobile">{t('activities.nextOn', { date: next === today ? t('common.today') : fmt.short(next) })}</span>}
          </span>
        </a>
      </li>
    )
  }

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('activities.count', { count: list.length })}</p>
          <h1 className="page-title">{t('activities.title')}</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => ui.open({ type: 'templates' })}>
            <Wand2 size={16} /> <span className="hide-mobile">{t('activities.templates')}</span>
          </button>
          <button className="btn" onClick={() => ui.open({ type: 'categories' })} aria-label={t('activities.categories')}>
            <FolderCog size={16} /> <span className="hide-mobile">{t('activities.categories')}</span>
          </button>
          <button className="btn btn-primary hide-mobile" onClick={() => ui.open({ type: 'editor' })}>
            <Plus size={16} /> {t('nav.new')}
          </button>
        </div>
      </header>

      <div className="filters">
        <div className="search">
          <Search size={17} aria-hidden />
          <input
            ref={searchRef}
            className="input"
            type="search"
            value={search}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            onChange={(e) => {
              setSearch(e.target.value)
              setQuery({ q: e.target.value || null })
            }}
          />
          <span className="kbd hide-mobile" aria-hidden>/</span>
        </div>
        <div className="filter-row">
          <div className="seg" role="group" aria-label={t('activities.filter.status')}>
            {(['active', 'archived', 'all'] as StatusFilter[]).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => setQuery({ status: s === 'active' ? null : s })}>
                {s === 'all' ? t('common.all') : t(`activities.filter.${s}`)}
              </button>
            ))}
          </div>
          <select className="select select-sm" value={category} onChange={(e) => setQuery({ cat: e.target.value || null })} aria-label={t('editor.category')}>
            <option value="">{t('activities.filter.allCategories')}</option>
            {index.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryName(c)}
              </option>
            ))}
            <option value="none">{t('editor.noCategory')}</option>
          </select>
          <select className="select select-sm" value={rec} onChange={(e) => setQuery({ rec: e.target.value || null })} aria-label={t('activities.filter.recurrence')}>
            <option value="">{t('activities.filter.recurrence')}: {t('common.all')}</option>
            <option value="recurring">{t('activities.filter.recurring')}</option>
            <option value="oneTime">{t('activities.filter.oneTime')}</option>
          </select>
          <select className="select select-sm" value={state} onChange={(e) => setQuery({ state: e.target.value || null })} aria-label={t('activities.filter.state')}>
            <option value="">{t('activities.filter.state')}: {t('common.all')}</option>
            <option value="openToday">{t('activities.filter.openToday')}</option>
            <option value="doneToday">{t('activities.filter.doneToday')}</option>
            <option value="onStreak">{t('activities.filter.onStreak')}</option>
            <option value="missedRecently">{t('activities.filter.missedRecently')}</option>
          </select>
          <label className="date-filter">
            <span className="subtle small">{t('activities.filter.date')}</span>
            <input className="input input-sm" type="date" value={onDate} onChange={(e) => setQuery({ date: e.target.value || null })} />
          </label>
          {filtersActive && (
            <button className="btn btn-ghost btn-sm" onClick={clear}>
              <X size={14} /> {t('activities.filter.clear')}
            </button>
          )}
        </div>
      </div>

      {index.activities.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Plus size={26} />
          </div>
          <h3>{t('activities.empty')}</h3>
          <p>{t('activities.emptyText')}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => ui.open({ type: 'editor' })}>
              <Plus size={16} /> {t('today.firstActivity')}
            </button>
            <button className="btn" onClick={() => ui.open({ type: 'templates' })}>
              <Wand2 size={16} /> {t('today.useTemplate')}
            </button>
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <p>{t('activities.noResults')}</p>
          <button className="btn btn-sm" onClick={clear}>
            {t('activities.filter.clear')}
          </button>
        </div>
      ) : (
        <ul className="activity-list surface">{list.map(row)}</ul>
      )}
    </div>
  )
}
