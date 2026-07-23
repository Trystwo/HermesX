import { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-bg-elevated text-fg-muted text-xs uppercase tracking-wide', className)}
      {...props}
    />
  )
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />
}

export function TableRow({
  className,
  highlight,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { highlight?: boolean }) {
  return (
    <tr
      className={cn(
        'transition-colors',
        highlight ? 'bg-brand/5' : 'hover:bg-bg-hover/50',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('px-3 py-2.5 text-left font-medium whitespace-nowrap', className)}
      {...props}
    />
  )
}

export function TableCell({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-3 py-2.5 text-fg whitespace-nowrap', className)} {...props}>
      {children}
    </td>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-fg-subtle py-12">
        {children || '暂无数据'}
      </td>
    </tr>
  )
}
