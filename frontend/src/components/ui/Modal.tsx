import { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number | string
  closable?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  closable = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, closable, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => closable && onClose()}
      />
      <div
        className="relative z-10 bg-bg-surface border border-border rounded-lg shadow-2xl w-full max-h-[90vh] flex flex-col"
        style={{ maxWidth: typeof width === 'number' ? `${width}px` : width }}
      >
        {title && (
          <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
            <div className="text-base font-medium text-fg">{title}</div>
            {closable && (
              <button
                onClick={onClose}
                className="text-fg-subtle hover:text-fg transition-colors p-1 rounded hover:bg-bg-hover"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-border shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: ReactNode
  content?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || '确认操作'}
      width={400}
      footer={
        <>
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-md text-sm bg-bg-elevated text-fg hover:bg-bg-hover transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'h-9 px-4 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-50',
              danger ? 'bg-up hover:brightness-110' : 'bg-brand hover:bg-brand-hover',
            )}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </>
      }
    >
      <div className="text-sm text-fg-muted leading-relaxed">{content}</div>
    </Modal>
  )
}
