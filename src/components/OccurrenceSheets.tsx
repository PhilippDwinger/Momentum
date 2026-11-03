import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  Check,
  Eye,
  Flame,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  Repeat,
  SkipForward,
  Undo2,
} from 'lucide-react'
import { resetOccurrence, setNote, setOccurrenceDetails, moveOccurrence } from '../data/actions'
import { addDays } from '../domain/dates'
import { getOccurrence, isDone, progressOf, statusOf } from '../domain/occurrences'
import { isOneTime } from '../domain/recurrence'
import type { Activity, DateKey, Occurrence } from '../domain/types'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { navigate } from '../state/router'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'
import { ActivityIcon } from './Icon'
import { Modal } from './Modal'
import { Bar } from './Progress'
import { useOccurrenceActions } from './useOccurrenceActions'

interface Props {
  activityId: string
  originalDate: DateKey
  onClose: () => void
}

function useLiveOccurrence(activityId: string, originalDate: DateKey) {
  const { index } = useAppData()
  const occ = useMemo(() => getOccurrence(index, activityId, originalDate), [index, activityId, originalDate])
  const activity = index.activityById.get(activityId)
  return { occ, activity }
}

function stepsFor(a: Activity): number[] {
  if (a.kind === 'duration') return [5, 10, 15]
  if (a.kind === 'count') return [1, 5, 10]
  return [0.5, 1, 5]
}

/** Value editor for measurable activities. */
function LogControl({ activity, occ, value, setValue }: { activity: Activity; occ: Occurrence; value: number; setValue: (v: number) => void }) {
  const { t, fmt, unitOf, amount } = useI18n()
  const step = activity.kind === 'custom' ? 0.5 : 1
  const unit = unitOf(activity)
  const pct = Math.min(1, value / (occ.target || 1))
  return (
    <div className="log-control">
      <div className="log-row">
        <button type="button" className="icon-btn bordered" onClick={() => setValue(Math.max(0, +(value - step).toFixed(2)))} aria-label="−">
          <Minus size={18} />
        </button>
        <div className="log-value">
          <input
            className="input log-input num"
            type="number"
            inputMode="decimal"
            min={0}
            step={step}
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
            aria-label={t('occ.progress')}
            data-autofocus
          />
          <span className="log-unit">
            {unit} · {t('occ.target', { value: amount(activity, occ.target) })}
          </span>
        </div>
        <button type="button" className="icon-btn bordered" onClick={() => setValue(+(value + step).toFixed(2))} aria-label="+">
          <Plus size={18} />
        </button>
      </div>
      <Bar value={pct} className={pct >= 1 ? 'success' : ''} />
      <div className="chips log-chips">
        {stepsFor(activity).map((s) => (
          <button type="button" key={s} className="chip" onClick={() => setValue(+(value + s).toFixed(2))}>
            +{fmt.number(s)} {unit}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setValue(occ.target)}>
          <Check size={14} /> {t('occ.goalReached')}
        </button>
        {value > 0 && (
          <button type="button" className="chip" onClick={() => setValue(0)}>
            {t('occ.clear')}
          </button>
        )}
      </div>
    </div>
  )
}

export function LogSheet({ activityId, originalDate, onClose }: Props) {
  const { t } = useI18n()
  const { occ, activity } = useLiveOccurrence(activityId, originalDate)
  const { complete } = useOccurrenceActions()
  const [value, setValue] = useState(() => occ?.entry?.value ?? 0)
  const [note, setNoteText] = useState(() => occ?.entry?.note ?? '')
  if (!occ || !activity) return null
  const save = async () => {
    await complete(occ, value, note)
    onClose()
  }
  return (
    <Modal
      title={activity.name}
      icon={<ActivityIcon icon={activity.icon} color={activity.color} size="sm" />}
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <LogControl activity={activity} occ={occ} value={value} setValue={setValue} />
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="log-note">{t('occ.note')}</label>
          <textarea id="log-note" className="textarea" rows={2} value={note} placeholder={t('occ.notePlaceholder')} onChange={(e) => setNoteText(e.target.value)} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function OccurrenceSheet({ activityId, originalDate, onClose }: Props) {
  const { t, fmt, relative } = useI18n()
  const { today, game } = useAppData()
  const ui = useUI()
  const { occ, activity } = useLiveOccurrence(activityId, originalDate)
  const actions = useOccurrenceActions()
  const [note, setNoteText] = useState(occ?.entry?.note ?? '')
  const savedNote = occ?.entry?.note ?? ''
  useEffect(() => setNoteText(savedNote), [savedNote])

  if (!occ || !activity) return null
  const status = statusOf(occ, today)
  const future = occ.date > today
  const streak = game.streaks.get(activity.id)
  const recurring = !isOneTime(activity)
  const measurable = activity.kind !== 'check'
  const open = (type: 'move' | 'occEdit' | 'log') => ui.open({ type, activityId, originalDate })

  return (
    <Modal title={activity.name} icon={<ActivityIcon icon={activity.icon} color={activity.color} size="sm" />} onClose={onClose}>
      <div className="occ-sheet-head">
        <span className="muted">{relative(occ.date, today)}{occ.time ? ` · ${occ.time}` : ''}</span>
        <span className={`badge ${status === 'done' ? 'success' : status === 'partial' ? 'warning' : status === 'missed' ? 'danger' : ''}`}>
          {t(`status.${status}`)}
        </span>
        {occ.moved && <span className="badge">{t('status.movedFrom', { date: fmt.short(occ.originalDate) })}</span>}
        {streak && streak.current > 0 && (
          <span className="badge accent">
            <Flame size={12} aria-hidden /> {streak.current}
          </span>
        )}
      </div>
      {activity.description && <p className="muted small" style={{ marginTop: 8 }}>{activity.description}</p>}

      {!occ.skipped && (
        <div style={{ marginTop: 16 }}>
          {future ? (
            <p className="subtle small">{t('today.futureHint')}</p>
          ) : measurable ? (
            <div className="occ-sheet-progress">
              <Bar value={progressOf(occ)} className={isDone(occ) ? 'success' : ''} />
              <button className="btn btn-primary btn-block" onClick={() => open('log')} style={{ marginTop: 12 }}>
                <PencilLine size={17} /> {t('occ.log')}
              </button>
            </div>
          ) : (
            <button className={`btn btn-block btn-lg ${isDone(occ) ? '' : 'btn-primary'}`} onClick={() => void actions.toggle(occ)}>
              {isDone(occ) ? <Undo2 size={18} /> : <Check size={18} />} {isDone(occ) ? t('occ.markUndone') : t('occ.markDone')}
            </button>
          )}
        </div>
      )}

      {!future && (
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="occ-note">{t('occ.note')}</label>
          <textarea
            id="occ-note"
            className="textarea"
            rows={2}
            value={note}
            placeholder={t('occ.notePlaceholder')}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={() => {
              if (note !== savedNote) void setNote(occ, note).catch(actions.fail)
            }}
          />
        </div>
      )}

      <div className="action-list" style={{ marginTop: 12 }}>
        <button onClick={() => open('move')}>
          <CalendarDays size={18} /> {t('occ.move')}
        </button>
        <button onClick={() => void actions.skip(occ, !occ.skipped)}>
          <SkipForward size={18} /> {occ.skipped ? t('occ.unskip') : t('occ.skip')}
        </button>
        <button onClick={() => open('occEdit')}>
          <CalendarClock size={18} /> {t('occ.editThis')}
        </button>
        {recurring && (
          <button
            onClick={() => {
              onClose()
              ui.open({ type: 'editor', activityId, scopeFrom: occ.originalDate })
            }}
          >
            <Repeat size={18} /> {t('occ.editFuture')}
          </button>
        )}
        <button
          onClick={() => {
            onClose()
            ui.open({ type: 'editor', activityId })
          }}
        >
          <PencilLine size={18} /> {recurring ? t('occ.editAll') : t('common.edit')}
        </button>
        <button
          onClick={() => {
            onClose()
            navigate(`/activity/${activityId}`)
          }}
        >
          <Eye size={18} /> {t('occ.viewActivity')}
        </button>
        {occ.override && (
          <button onClick={() => void resetOccurrence(occ).catch(actions.fail)}>
            <RotateCcw size={18} /> {t('occ.resetChanges')}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function MoveSheet({ activityId, originalDate, onClose }: Props) {
  const { t, fmt } = useI18n()
  const { today } = useAppData()
  const { occ, activity } = useLiveOccurrence(activityId, originalDate)
  const { move } = useOccurrenceActions()
  const [date, setDate] = useState(() => (occ ? (occ.date < today ? today : addDays(occ.date, 1)) : today))
  if (!occ || !activity) return null
  const quick = [today, addDays(today, 1), addDays(occ.date, 1)].filter((d, i, arr) => d !== occ.date && arr.indexOf(d) === i && d >= today)
  const submit = async (d: DateKey) => {
    await move(occ, d)
    onClose()
  }
  return (
    <Modal
      title={t('occ.moveTitle')}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit(date)} disabled={!date || date === occ.date}>
            {t('occ.move')}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginBottom: 12 }}>
        {activity.name} · {fmt.long(occ.date)}
      </p>
      <div className="chips" style={{ marginBottom: 14 }}>
        {quick.map((d) => (
          <button key={d} className="chip" onClick={() => void submit(d)}>
            {d === today ? t('occ.moveToToday') : d === addDays(today, 1) ? t('occ.moveToTomorrow') : fmt.medium(d)}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="move-date">{t('occ.moveDate')}</label>
        <input id="move-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
  )
}

export function OccurrenceEditSheet({ activityId, originalDate, onClose }: Props) {
  const { t, unitOf } = useI18n()
  const toast = useToast()
  const { occ, activity } = useLiveOccurrence(activityId, originalDate)
  const { fail } = useOccurrenceActions()
  const [date, setDate] = useState(occ?.date ?? originalDate)
  const [time, setTime] = useState(occ?.time ?? '')
  const [target, setTarget] = useState(String(occ?.target ?? 1))
  if (!occ || !activity) return null
  const measurable = activity.kind !== 'check'
  const save = async () => {
    try {
      const tgt = Number(target)
      await setOccurrenceDetails(occ, {
        time: time && time !== activity.time ? time : null,
        target: measurable && tgt > 0 && tgt !== occ.target ? tgt : (occ.override?.target ?? null),
      })
      if (date && date !== occ.date) {
        const fresh = { ...occ }
        await moveOccurrence(fresh, date)
      }
      toast({ message: t('toast.saved') })
      onClose()
    } catch (e) {
      fail(e)
    }
  }
  return (
    <Modal
      title={t('occ.thisTitle')}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="muted small" style={{ marginBottom: 14 }}>
        {activity.name}
      </p>
      <div className="row">
        <div className="field">
          <label htmlFor="oe-date">{t('occ.thisDate')}</label>
          <input id="oe-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="oe-time">{t('occ.thisTime')}</label>
          <input id="oe-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      {measurable && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="oe-target">{t('occ.thisTarget')}</label>
          <div className="input-suffix">
            <input id="oe-target" className="input" type="number" min={0} step="any" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            <span>{unitOf(activity)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
