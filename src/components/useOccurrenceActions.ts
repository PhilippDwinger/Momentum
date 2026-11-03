import { useCallback } from 'react'
import { FutureLogError, logProgress, moveOccurrence, skipOccurrence, toggleDone } from '../data/actions'
import { isDone } from '../domain/occurrences'
import type { DateKey, Occurrence } from '../domain/types'
import { useI18n } from '../i18n'
import { celebrationText } from '../domain/notifications'
import { useAppData } from '../state/AppData'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'

/** Shared occurrence interactions with consistent feedback + undo. */
export function useOccurrenceActions() {
  const { index, today, game } = useAppData()
  const { t, fmt, lang } = useI18n()
  const toast = useToast()
  const ui = useUI()

  const fail = useCallback(
    (err: unknown) => {
      const message = err instanceof FutureLogError ? t('occ.futureLocked') : err instanceof Error ? err.message : String(err)
      toast({ message: t('toast.error', { message }), tone: 'error' })
    },
    [t, toast],
  )

  const nameOf = useCallback((occ: Occurrence) => index.activityById.get(occ.activityId)?.name ?? '', [index])

  const toggle = useCallback(
    async (occ: Occurrence) => {
      const a = index.activityById.get(occ.activityId)
      if (!a) return
      if (a.kind !== 'check') {
        ui.open({ type: 'log', activityId: occ.activityId, originalDate: occ.originalDate })
        return
      }
      const prevValue = occ.entry?.value ?? 0
      try {
        const nowDone = await toggleDone(occ, today)
        if ('vibrate' in navigator && nowDone) navigator.vibrate?.(8)
        const streak = (game.streaks.get(a.id)?.current ?? 0) + 1
        const cheer = nowDone && occ.date === today ? celebrationText(lang, index.settings.notifyTone || 'intense', a, streak, occ.key) : null
        toast({
          message: cheer ?? t(nowDone ? 'toast.done' : 'toast.undone', { name: a.name }),
          tone: cheer && streak >= 3 ? 'celebrate' : undefined,
          action: { label: t('common.undo'), run: () => void logProgress({ ...occ, entry: occ.entry }, prevValue, today).catch(fail) },
        })
      } catch (e) {
        fail(e)
      }
    },
    [index, today, toast, t, ui, fail, game, lang],
  )

  const complete = useCallback(
    async (occ: Occurrence, value: number, note?: string) => {
      const prev = occ.entry?.value ?? 0
      const prevNote = occ.entry?.note ?? ''
      try {
        await logProgress(occ, value, today, note)
        const done = value >= occ.target
        if (done && !isDone(occ)) {
          const a = index.activityById.get(occ.activityId)
          const streak = (game.streaks.get(occ.activityId)?.current ?? 0) + 1
          toast({
            message: a && occ.date === today ? celebrationText(lang, index.settings.notifyTone || 'intense', a, streak, occ.key) : t('toast.done', { name: nameOf(occ) }),
            tone: streak >= 3 ? 'celebrate' : undefined,
            action: { label: t('common.undo'), run: () => void logProgress(occ, prev, today, prevNote).catch(fail) },
          })
        }
      } catch (e) {
        fail(e)
      }
    },
    [today, toast, t, nameOf, fail, index, game, lang],
  )

  const move = useCallback(
    async (occ: Occurrence, to: DateKey) => {
      const from = occ.date
      try {
        await moveOccurrence(occ, to)
        toast({
          message: t('toast.moved', { date: fmt.medium(to) }),
          action: { label: t('common.undo'), run: () => void moveOccurrence({ ...occ, override: occ.override }, from).catch(fail) },
        })
      } catch (e) {
        fail(e)
      }
    },
    [toast, t, fmt, fail],
  )

  const skip = useCallback(
    async (occ: Occurrence, skipped: boolean) => {
      try {
        await skipOccurrence(occ, skipped)
        toast({
          message: t(skipped ? 'toast.skipped' : 'toast.unskipped'),
          action: { label: t('common.undo'), run: () => void skipOccurrence(occ, !skipped).catch(fail) },
        })
      } catch (e) {
        fail(e)
      }
    },
    [toast, t, fail],
  )

  const open = useCallback(
    (occ: Occurrence) => ui.open({ type: 'occurrence', activityId: occ.activityId, originalDate: occ.originalDate }),
    [ui],
  )

  return { toggle, complete, move, skip, open, fail }
}
