import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastStore, ToastType } from '@/stores/toast'
import { cn } from '@/utils/cn'

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warn: AlertTriangle,
  info: Info,
}

const colors: Record<ToastType, string> = {
  success: 'text-down border-down/30 bg-down/10',
  error: 'text-up border-up/30 bg-up/10',
  warn: 'text-warn border-warn/30 bg-warn/10',
  info: 'text-brand border-brand/30 bg-brand/10',
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((t) => {
        const Icon = icons[t.type]
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 p-3 rounded-md border bg-bg-surface shadow-lg',
              'animate-in slide-in-from-right',
              colors[t.type],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm text-fg leading-snug">{t.message}</p>
            <button
              onClick={() => removeToast(t.id)}
              className="text-fg-subtle hover:text-fg transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
