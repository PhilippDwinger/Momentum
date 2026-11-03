import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Info, PartyPopper, TriangleAlert } from 'lucide-react'

export interface ToastInput {
  message: string
  tone?: 'success' | 'info' | 'error' | 'celebrate'
  action?: { label: string; run: () => void }
  duration?: number
}
interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current
      setItems((list) => [...list.slice(-1), { ...t, id }])
      setTimeout(() => dismiss(id), t.duration ?? (t.action ? 6000 : 3500))
    },
    [dismiss],
  )
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span className="toast-icon" aria-hidden>
              {t.tone === 'error' ? (
                <TriangleAlert size={18} color="var(--danger)" />
              ) : t.tone === 'celebrate' ? (
                <PartyPopper size={18} />
              ) : t.tone === 'info' ? (
                <Info size={18} color="currentColor" />
              ) : (
                <CircleCheck size={18} />
              )}
            </span>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
