import { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title = '暂无数据',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      <div className="text-fg-subtle mb-3">
        {icon || <Inbox size={40} strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="text-xs text-fg-muted mt-1 text-center max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
