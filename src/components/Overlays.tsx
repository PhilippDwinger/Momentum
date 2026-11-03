import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { UIContext, type Overlay, type OverlaySpec, type UIApi } from '../state/uiContext'
import { ActivityEditor } from './ActivityEditor'
import { ConfirmDialog } from './Modal'
import { CategoriesSheet, ImportSheet, ShortcutsSheet, TemplatesSheet } from './MiscSheets'
import { ConflictsDialog, SyncChoiceDialog } from './SyncPanels'
import { LogSheet, MoveSheet, OccurrenceEditSheet, OccurrenceSheet } from './OccurrenceSheets'

/** Hosts all dialogs/sheets as a stack so they can be opened from anywhere. */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Overlay[]>([])
  const seq = useRef(0)

  const open = useCallback((spec: OverlaySpec) => {
    const id = ++seq.current
    setStack((s) => [...s, { ...spec, id } as Overlay])
    return id
  }, [])
  const close = useCallback((id: number) => setStack((s) => s.filter((o) => o.id !== id)), [])
  const confirm = useCallback<UIApi['confirm']>(
    (opts) =>
      new Promise((resolve) => {
        open({ type: 'confirm', ...opts, resolve })
      }),
    [open],
  )
  const api = useMemo<UIApi>(() => ({ open, close, confirm }), [open, close, confirm])

  return (
    <UIContext.Provider value={api}>
      {children}
      {stack.map((o) => {
        const onClose = () => close(o.id)
        switch (o.type) {
          case 'editor':
            return <ActivityEditor key={o.id} {...o} onClose={onClose} />
          case 'occurrence':
            return <OccurrenceSheet key={o.id} activityId={o.activityId} originalDate={o.originalDate} onClose={onClose} />
          case 'log':
            return <LogSheet key={o.id} activityId={o.activityId} originalDate={o.originalDate} onClose={onClose} />
          case 'move':
            return <MoveSheet key={o.id} activityId={o.activityId} originalDate={o.originalDate} onClose={onClose} />
          case 'occEdit':
            return <OccurrenceEditSheet key={o.id} activityId={o.activityId} originalDate={o.originalDate} onClose={onClose} />
          case 'templates':
            return <TemplatesSheet key={o.id} onClose={onClose} />
          case 'categories':
            return <CategoriesSheet key={o.id} onClose={onClose} />
          case 'shortcuts':
            return <ShortcutsSheet key={o.id} onClose={onClose} />
          case 'syncChoice':
            return <SyncChoiceDialog key={o.id} onClose={onClose} />
          case 'conflicts':
            return <ConflictsDialog key={o.id} onClose={onClose} />
          case 'import':
            return <ImportSheet key={o.id} parsed={o.parsed} onClose={onClose} />
          case 'confirm':
            return (
              <ConfirmDialog
                key={o.id}
                title={o.title}
                message={o.message}
                confirmLabel={o.confirmLabel}
                danger={o.danger}
                onResult={(ok) => {
                  o.resolve(ok)
                  onClose()
                }}
              />
            )
          default:
            return null
        }
      })}
    </UIContext.Provider>
  )
}
