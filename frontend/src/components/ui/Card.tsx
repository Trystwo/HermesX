import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  extra?: ReactNode
  noPadding?: boolean
}

export function Card({ title, extra, noPadding, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-bg-surface',
        className,
      )}
      {...props}
    >
      {(title || extra) && (
        <div className="flex items-center justify-between px-4 h-12 border-b border-border">
          <div className="text-sm font-medium text-fg">{title}</div>
          {extra && <div className="flex items-center gap-2">{extra}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-4')}>{children}</div>
    </div>
  )
}
