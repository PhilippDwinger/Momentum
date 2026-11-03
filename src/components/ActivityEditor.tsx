import { useMemo, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import {
  archiveActivity,
  createActivity,
  deleteActivity,
  restoreActivity,
  updateActivity,
  type ActivityDraft,
  type ScheduleScope,
} from '../data/actions'
import { nthInMonth, parseKey, weekday } from '../domain/dates'
import { isOneTime, nextScheduledDates, segmentFor } from '../domain/recurrence'
import type { TemplateItem } from '../domain/templates'
import { COLOR_KEYS, type Activity, type ActivityKind, type DateKey, type RecurrenceRule, type Weekday } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { navigate } from '../state/router'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'
import { ACTIVITY_ICON_CHOICES, ActivityIcon, NamedIcon, acStyle } from './Icon'
import { Modal } from './Modal'

type Preset = 'once' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'everyX' | 'custom'
const PRESETS: Preset[] = ['once', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'everyX', 'custom']
const KINDS: ActivityKind[] = ['check', 'duration', 'count', 'custom']

interface RuleState {
  preset: Preset
  interval: number
  unit: 'days' | 'weeks' | 'months'
  weekdays: Weekday[]
  monthlyMode: 'day' | 'weekday'
  monthDay: number
  nth: number
  nthWeekday: Weekday
}

function ruleToState(rule: RecurrenceRule, anchor: DateKey): RuleState {
  const base: RuleState = {
    preset: 'daily',
    interval: rule.interval || 1,
    unit: 'days',
    weekdays: rule.weekdays?.length ? rule.weekdays : [weekday(anchor)],
    monthlyMode: rule.monthlyMode ?? 'day',
    monthDay: rule.monthDay ?? parseKey(anchor).d,
    nth: rule.nth ?? Math.min(4, nthInMonth(anchor)),
    nthWeekday: rule.nthWeekday ?? weekday(anchor),
  }
  switch (rule.freq) {
    case 'once':
      return { ...base, preset: 'once' }
    case 'daily':
      return { ...base, preset: rule.interval === 1 ? 'daily' : 'everyX', interval: Math.max(2, rule.interval) }
    case 'weekly': {
      const wk = base.weekdays.join()
      if (rule.interval === 1 && wk === '1,2,3,4,5') return { ...base, preset: 'weekdays', unit: 'weeks' }
      if (rule.interval === 1) return { ...base, preset: 'weekly', unit: 'weeks' }
      if (rule.interval === 2) return { ...base, preset: 'biweekly', unit: 'weeks' }
      return { ...base, preset: 'custom', unit: 'weeks' }
    }
    case 'monthly':
      return { ...base, preset: rule.interval === 1 && base.monthlyMode === 'day' ? 'monthly' : 'custom', unit: 'months' }
  }
}

function stateToRule(s: RuleState, anchor: DateKey): RecurrenceRule {
  switch (s.preset) {
    case 'once':
      return { freq: 'once', interval: 1 }
    case 'daily':
      return { freq: 'daily', interval: 1 }
    case 'everyX':
      return { freq: 'daily', interval: Math.max(2, s.interval) }
    case 'weekdays':
      return { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }
    case 'weekly':
      return { freq: 'weekly', interval: 1, weekdays: s.weekdays }
    case 'biweekly':
      return { freq: 'weekly', interval: 2, weekdays: s.weekdays }
    case 'monthly':
      return { freq: 'monthly', interval: 1, monthlyMode: 'day', monthDay: parseKey(anchor).d }
    case 'custom':
      if (s.unit === 'days') return { freq: 'daily', interval: Math.max(1, s.interval) }
      if (s.unit === 'weeks') return { freq: 'weekly', interval: Math.max(1, s.interval), weekdays: s.weekdays }
      return s.monthlyMode === 'weekday'
        ? { freq: 'monthly', interval: Math.max(1, s.interval), monthlyMode: 'weekday', nth: s.nth, nthWeekday: s.nthWeekday }
        : { freq: 'monthly', interval: Math.max(1, s.interval), monthlyMode: 'day', monthDay: s.monthDay }
  }
}

interface EditorProps {
  activityId?: string
  date?: DateKey
  scopeFrom?: DateKey
  template?: TemplateItem
  onClose: () => void
}

export function ActivityEditor({ activityId, date, scopeFrom, template, onClose }: EditorProps) {
  const { t, lang, fmt, describeRule, categoryName } = useI18n()
  const { index, today } = useAppData()
  const toast = useToast()
  const ui = useUI()
  const existing = activityId ? index.activityById.get(activityId) : undefined

  const initial = useMemo((): { draft: ActivityDraft; rule: RuleState } => {
    if (existing) {
      const seg = segmentFor(existing, scopeFrom ?? (today > existing.startDate ? today : existing.startDate)) ?? existing.schedule[0]
      return {
        draft: {
          name: existing.name,
          description: existing.description,
          icon: existing.icon,
          color: existing.color,
          categoryId: existing.categoryId,
          kind: existing.kind,
          unit: existing.unit,
          startDate: existing.startDate,
          endDate: existing.endDate,
          rule: seg.rule,
          target: seg.target,
          time: existing.time,
          durationMinutes: existing.durationMinutes,
          reminderTime: existing.reminderTime,
          partialCounts: existing.partialCounts,
          notes: existing.notes,
        },
        rule: ruleToState(seg.rule, seg.from),
      }
    }
    const start = date ?? today
    const fromTpl = template
      ? {
          name: template.name[lang],
          description: template.description?.[lang] ?? '',
          icon: template.icon,
          color: template.color,
          categoryId: index.categoryById.has(`cat_${template.category}`) ? `cat_${template.category}` : null,
          kind: template.kind,
          unit: template.unit?.[lang] ?? '',
          rule: template.rule,
          target: template.target,
          time: template.time ?? null,
          durationMinutes: template.durationMinutes ?? null,
        }
      : null
    const rule: RecurrenceRule = fromTpl?.rule ?? (date && date !== today ? { freq: 'once', interval: 1 } : { freq: 'daily', interval: 1 })
    const draft: ActivityDraft = {
      name: '',
      description: '',
      icon: 'i:circle-check',
      color: COLOR_KEYS[index.activities.length % COLOR_KEYS.length],
      categoryId: null,
      kind: 'check',
      unit: '',
      startDate: start,
      endDate: null,
      rule,
      target: 1,
      time: null,
      durationMinutes: null,
      reminderTime: null,
      partialCounts: false,
      notes: '',
      ...fromTpl,
    }
    return { draft, rule: ruleToState(rule, start) }
  }, [existing, scopeFrom, today, date, template, lang, index])

  const [d, setD] = useState<ActivityDraft>(initial.draft)
  const [rs, setRs] = useState<RuleState>(initial.rule)
  const [showMore, setShowMore] = useState(!!(existing && (existing.description || existing.notes || existing.endDate || existing.durationMinutes)))
  const [emoji, setEmoji] = useState(d.icon.startsWith('i:') ? '' : d.icon)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [askScope, setAskScope] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof ActivityDraft>(k: K, v: ActivityDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setRule = (patch: Partial<RuleState>) => setRs((x) => ({ ...x, ...patch }))

  const anchor = scopeFrom ?? d.startDate
  const rule = stateToRule(rs, anchor)
  const measurable = d.kind !== 'check'
  const lockedStart = !!scopeFrom

  const preview = useMemo(() => {
    const probe: Activity = {
      ...(existing ?? ({} as Activity)),
      id: 'preview',
      deletedAt: null,
      archivedAt: null,
      pauses: existing?.pauses ?? [],
      startDate: d.startDate,
      endDate: d.endDate,
      schedule: [{ from: anchor, rule, target: d.target }],
    } as Activity
    const from = anchor > today ? anchor : today
    return nextScheduledDates(probe, from, 5)
  }, [existing, d.startDate, d.endDate, anchor, rule, d.target, today])

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!d.name.trim()) e.name = t('editor.nameRequired')
    if ((rs.preset === 'weekly' || rs.preset === 'biweekly' || (rs.preset === 'custom' && rs.unit === 'weeks')) && rs.weekdays.length === 0)
      e.weekdays = t('editor.weekdaysRequired')
    if (d.endDate && d.endDate < d.startDate) e.endDate = t('editor.endBeforeStart')
    if (measurable && !(Number(d.target) > 0)) e.target = t('editor.targetInvalid')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function scheduleChanged(): boolean {
    if (!existing) return false
    const seg = segmentFor(existing, today > existing.startDate ? today : existing.startDate) ?? existing.schedule[0]
    return JSON.stringify(seg.rule) !== JSON.stringify(rule) || seg.target !== (measurable ? Number(d.target) : 1) || existing.startDate !== d.startDate
  }

  async function persist(scope: ScheduleScope) {
    setBusy(true)
    try {
      const draft: ActivityDraft = { ...d, rule, target: measurable ? Number(d.target) : 1, icon: emoji.trim() ? emoji.trim().slice(0, 4) : d.icon.startsWith('i:') ? d.icon : 'i:circle-check' }
      if (existing) {
        await updateActivity(existing, draft, scope)
        toast({ message: t('toast.saved') })
      } else {
        const a = await createActivity(draft, index)
        toast({ message: t('toast.created', { name: a.name }) })
      }
      onClose()
    } catch (e) {
      toast({ message: t('toast.error', { message: e instanceof Error ? e.message : String(e) }), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function onSave() {
    if (!validate()) return
    if (!existing) return persist({ mode: 'all' })
    if (scopeFrom) return persist({ mode: 'from', from: scopeFrom })
    const hasPast = existing.startDate < today && !isOneTime(existing)
    if (scheduleChanged() && hasPast) {
      setAskScope(true)
      return
    }
    return persist({ mode: 'all' })
  }

  async function onDelete() {
    if (!existing) return
    const ok = await ui.confirm({ title: t('common.delete'), message: t('detail.deleteConfirm', { name: existing.name }), confirmLabel: t('common.delete'), danger: true })
    if (!ok) return
    const entries = index.entriesByActivity.get(existing.id) ?? []
    const overrides = [...index.overrides.values()].filter((o) => o.activityId === existing.id)
    await deleteActivity(existing)
    onClose()
    navigate('/activities')
    toast({ message: t('detail.deleted', { name: existing.name }), action: { label: t('common.undo'), run: () => void restoreActivity({ activity: existing, entries, overrides }) } })
  }

  async function onArchive() {
    if (!existing) return
    await archiveActivity(existing, today, index)
    toast({ message: t('detail.archivedToast', { name: existing.name }) })
    onClose()
  }

  const title = existing ? (scopeFrom ? t('editor.editFuture', { date: fmt.short(scopeFrom) }) : t('editor.edit')) : t('editor.new')

  if (askScope && existing) {
    return (
      <Modal title={t('scope.title')} onClose={() => setAskScope(false)} size="narrow">
        <p className="muted" style={{ marginBottom: 14 }}>{t('scope.text')}</p>
        <div className="scope-options">
          <button className="scope-option" onClick={() => void persist({ mode: 'from', from: today })} disabled={busy} data-autofocus>
            <strong>{t('scope.fromToday')}</strong>
            <span>{t('scope.fromHint')}</span>
          </button>
          <button className="scope-option" onClick={() => void persist({ mode: 'all' })} disabled={busy}>
            <strong>{t('scope.all')}</strong>
            <span>{t('scope.allHint')}</span>
          </button>
        </div>
      </Modal>
    )
  }

  const weekdayButtons = (
    <div className="weekday-picker" role="group" aria-label={t('editor.onDays')} style={acStyle(d.color)}>
      {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((wd) => {
        const on = rs.weekdays.includes(wd)
        return (
          <button
            key={wd}
            type="button"
            aria-pressed={on}
            onClick={() => setRule({ weekdays: on ? rs.weekdays.filter((x) => x !== wd) : [...rs.weekdays, wd].sort() as Weekday[] })}
          >
            {fmt.weekdayShort(wd).slice(0, 2)}
          </button>
        )
      })}
    </div>
  )

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="wide"
      footer={
        <>
          {existing && !scopeFrom && (
            <>
              <button className="icon-btn" onClick={() => void onDelete()} aria-label={t('common.delete')} title={t('common.delete')}>
                <Trash2 size={18} color="var(--danger)" />
              </button>
              {!existing.archivedAt && (
                <button className="icon-btn" onClick={() => void onArchive()} aria-label={t('detail.archive')} title={t('detail.archive')}>
                  <Archive size={18} />
                </button>
              )}
            </>
          )}
          <span className="spacer hide-mobile" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void onSave()} disabled={busy}>
            {existing ? t('common.save') : t('common.create')}
          </button>
        </>
      }
    >
      <form
        className="editor"
        onSubmit={(e) => {
          e.preventDefault()
          void onSave()
        }}
      >
        <div className="editor-name">
          <ActivityIcon icon={emoji.trim() || d.icon} color={d.color} size="lg" />
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="ed-name">{t('editor.name')}</label>
            <input
              id="ed-name"
              className="input"
              value={d.name}
              maxLength={80}
              placeholder={t('editor.namePlaceholder')}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={!!errors.name}
              autoComplete="off"
              data-autofocus={!existing ? true : undefined}
            />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t('editor.icon')}</span>
          <div className="icon-grid" role="radiogroup" aria-label={t('editor.icon')} style={acStyle(d.color)}>
            {ACTIVITY_ICON_CHOICES.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={!emoji && d.icon === `i:${name}`}
                aria-label={name}
                onClick={() => {
                  setEmoji('')
                  set('icon', `i:${name}`)
                }}
              >
                <NamedIcon name={name} size={18} />
              </button>
            ))}
            <input className="input emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="😀" aria-label={t('editor.emoji')} maxLength={8} />
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t('editor.color')}</span>
          <div className="swatches" role="radiogroup" aria-label={t('editor.color')}>
            {COLOR_KEYS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={d.color === c} aria-label={c} style={acStyle(c)} onClick={() => set('color', c)} />
            ))}
          </div>
        </div>

        <div className="row stack-sm">
          <div className="field">
            <label htmlFor="ed-cat">{t('editor.category')}</label>
            <select id="ed-cat" className="select" value={d.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
              <option value="">{t('editor.noCategory')}</option>
              {index.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ed-time">{t('editor.time')} <span className="subtle">({t('common.optional')})</span></label>
            <input id="ed-time" className="input" type="time" value={d.time ?? ''} onChange={(e) => set('time', e.target.value || null)} />
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t('editor.type')}</span>
          <div className="seg full" role="group" aria-label={t('editor.type')}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={d.kind === k}
                onClick={() =>
                  setD((x) => ({
                    ...x,
                    kind: k,
                    target: k === 'check' ? 1 : x.kind === 'check' ? (k === 'duration' ? 15 : k === 'count' ? 10 : 1) : x.target,
                    unit: k === 'duration' ? 'min' : x.kind === 'duration' ? '' : x.unit,
                  }))
                }
              >
                {t(`editor.kind.${k}`)}
              </button>
            ))}
          </div>
          <span className="field-hint">{t(`editor.kindHint.${d.kind}`)}</span>
        </div>

        {measurable && (
          <>
            <div className="row">
              <div className="field">
                <label htmlFor="ed-target">{t('editor.target')}</label>
                <input
                  id="ed-target"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={d.kind === 'custom' ? 'any' : 1}
                  value={d.target}
                  onChange={(e) => set('target', Number(e.target.value))}
                  aria-invalid={!!errors.target}
                />
                {errors.target && <span className="field-error">{errors.target}</span>}
              </div>
              <div className="field">
                <label htmlFor="ed-unit">{t('editor.unit')}</label>
                {d.kind === 'duration' ? (
                  <input id="ed-unit" className="input" value={t('common.minutes')} disabled />
                ) : (
                  <input id="ed-unit" className="input" value={d.unit} maxLength={20} placeholder={t('editor.unitPlaceholder')} onChange={(e) => set('unit', e.target.value)} />
                )}
              </div>
            </div>
            <label className="switch">
              <span className="switch-text">
                {t('editor.partial')}
                <small>{t('editor.partialHint')}</small>
              </span>
              <input type="checkbox" checked={d.partialCounts} onChange={(e) => set('partialCounts', e.target.checked)} />
            </label>
          </>
        )}

        <fieldset className="field editor-schedule">
          <legend className="field-label">{t('editor.schedule')}</legend>
          {lockedStart && <p className="field-hint">{t('editor.recurringLocked', { date: fmt.medium(scopeFrom!) })}</p>}
          <div className="chips" role="group">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={rs.preset === p} onClick={() => setRule({ preset: p, interval: p === 'everyX' ? Math.max(2, rs.interval) : rs.interval })}>
                {t(`editor.freq.${p}`)}
              </button>
            ))}
          </div>

          {(rs.preset === 'weekly' || rs.preset === 'biweekly') && weekdayButtons}
          {rs.preset === 'everyX' && (
            <div className="input-group">
              <span className="muted">{t('editor.every')}</span>
              <input className="input" style={{ width: 90 }} type="number" min={2} max={365} value={rs.interval} onChange={(e) => setRule({ interval: Number(e.target.value) })} aria-label={t('editor.every')} />
              <span className="muted">{t('editor.unit.days')}</span>
            </div>
          )}
          {rs.preset === 'custom' && (
            <div className="custom-rule">
              <div className="input-group">
                <span className="muted">{t('editor.every')}</span>
                <input className="input" style={{ width: 80 }} type="number" min={1} max={365} value={rs.interval} onChange={(e) => setRule({ interval: Number(e.target.value) })} aria-label={t('editor.every')} />
                <select className="select" style={{ width: 'auto' }} value={rs.unit} onChange={(e) => setRule({ unit: e.target.value as RuleState['unit'] })} aria-label={t('editor.schedule')}>
                  <option value="days">{t('editor.unit.days')}</option>
                  <option value="weeks">{t('editor.unit.weeks')}</option>
                  <option value="months">{t('editor.unit.months')}</option>
                </select>
              </div>
              {rs.unit === 'weeks' && weekdayButtons}
              {rs.unit === 'months' && (
                <div className="seg full" role="group" aria-label={t('editor.monthBy')}>
                  <button type="button" aria-pressed={rs.monthlyMode === 'day'} onClick={() => setRule({ monthlyMode: 'day', monthDay: parseKey(anchor).d })}>
                    {t('editor.monthByDay', { day: parseKey(anchor).d })}
                  </button>
                  <button
                    type="button"
                    aria-pressed={rs.monthlyMode === 'weekday'}
                    onClick={() => setRule({ monthlyMode: 'weekday', nth: nthInMonth(anchor) > 4 ? -1 : nthInMonth(anchor), nthWeekday: weekday(anchor) })}
                  >
                    {t('editor.monthByWeekday', { nth: t(`editor.nth.${nthInMonth(anchor) > 4 ? -1 : nthInMonth(anchor)}`), weekday: fmt.weekdayLong(weekday(anchor)) })}
                  </button>
                </div>
              )}
            </div>
          )}
          {errors.weekdays && <span className="field-error">{errors.weekdays}</span>}

          <div className="row">
            <div className="field">
              <label htmlFor="ed-start">{rs.preset === 'once' ? t('editor.date') : t('editor.startDate')}</label>
              <input id="ed-start" className="input" type="date" value={d.startDate} disabled={lockedStart} onChange={(e) => e.target.value && set('startDate', e.target.value)} />
            </div>
            {rs.preset !== 'once' && (
              <div className="field">
                <label htmlFor="ed-end">{t('editor.endDate')} <span className="subtle">({t('common.optional')})</span></label>
                <input id="ed-end" className="input" type="date" value={d.endDate ?? ''} min={d.startDate} onChange={(e) => set('endDate', e.target.value || null)} aria-invalid={!!errors.endDate} />
                {errors.endDate && <span className="field-error">{errors.endDate}</span>}
              </div>
            )}
          </div>

          <div className="preview" aria-live="polite">
            <span className="field-label">{describeRule(rule, anchor)}</span>
            <div className="preview-dates">
              {preview.length === 0 ? (
                <span className="subtle small">{t('editor.noUpcoming')}</span>
              ) : (
                preview.map((p) => (
                  <span key={p} className="badge">
                    {fmt.medium(p)}
                  </span>
                ))
              )}
            </div>
          </div>
        </fieldset>

        <label className="switch">
          <span className="switch-text">
            {t('editor.reminder')}
            <small>{t('editor.reminderHint')}</small>
          </span>
          <input type="checkbox" checked={!!d.reminderTime} onChange={(e) => set('reminderTime', e.target.checked ? d.time || '09:00' : null)} />
        </label>
        {d.reminderTime && (
          <div className="field" style={{ maxWidth: 200 }}>
            <input className="input" type="time" value={d.reminderTime} onChange={(e) => set('reminderTime', e.target.value || null)} aria-label={t('editor.reminder')} />
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-sm more-toggle" onClick={() => setShowMore((x) => !x)} aria-expanded={showMore}>
          {showMore ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {showMore ? t('editor.fewer') : t('editor.more')}
        </button>
        {showMore && (
          <>
            <div className="field">
              <label htmlFor="ed-desc">{t('editor.description')}</label>
              <input id="ed-desc" className="input" value={d.description} maxLength={500} placeholder={t('editor.descriptionPlaceholder')} onChange={(e) => set('description', e.target.value)} />
            </div>
            {d.kind !== 'duration' && (
              <div className="field" style={{ maxWidth: 260 }}>
                <label htmlFor="ed-dur">{t('editor.duration')}</label>
                <input id="ed-dur" className="input" type="number" min={0} max={1440} value={d.durationMinutes ?? ''} onChange={(e) => set('durationMinutes', e.target.value ? Number(e.target.value) : null)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="ed-notes">{t('editor.notes')}</label>
              <textarea id="ed-notes" className="textarea" value={d.notes} placeholder={t('editor.notesPlaceholder')} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
