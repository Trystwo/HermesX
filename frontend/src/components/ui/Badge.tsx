import { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'danger'
  | 'warn'
  | 'info'
  | 'neutral'
  | 'brand'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  children: ReactNode
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-bg-hover text-fg border-border',
  success: 'bg-down/15 text-down border-down/30',
  danger: 'bg-up/15 text-up border-up/30',
  warn: 'bg-warn/15 text-warn border-warn/30',
  info: 'bg-brand/15 text-brand border-brand/30',
  neutral: 'bg-fg-subtle/15 text-fg-muted border-border',
  brand: 'bg-brand/20 text-brand border-brand/40',
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
