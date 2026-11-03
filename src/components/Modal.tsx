import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'narrow' | 'normal' | 'wide'
  icon?: ReactNode
  labelledBy?: string
}

let openModals = 0

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Centered dialog on desktop, bottom sheet on phones. Traps focus and restores it on close. */
export function Modal({ title, onClose, children, footer, size = 'normal', icon }: ModalProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('.modal-body ' + FOCUSABLE)
    // avoid popping the keyboard on phones unless explicitly requested
    if (first && (first.hasAttribute('data-autofocus') || window.matchMedia('(pointer: fine)').matches)) first.focus({ preventScroll: true })
    else el?.focus()
    openModals++
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
        if (items.length === 0) return
        const firstEl = items[0]
        const lastEl = items[items.length - 1]
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
    el?.addEventListener('keydown', onKey)
    return () => {
      el?.removeEventListener('keydown', onKey)
      openModals--
      if (openModals <= 0) document.body.style.overflow = ''
      prev?.focus?.({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`modal ${size === 'normal' ? '' : size}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="modal-head">
          {icon}
          <h2 className="modal-title">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onResult,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onResult: (ok: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Modal
      title={title}
      size="narrow"
      onClose={() => onResult(false)}
      footer={
        <>
          <button className="btn" onClick={() => onResult(false)}>
            {t('common.cancel')}
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onResult(true)} data-autofocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  )
}
