import { ReactNode, useState } from 'react'
import { cn } from '@/utils/cn'

export interface TabItem {
  key: string
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onChange?: (key: string) => void
  className?: string
}

export function Tabs({ items, value, defaultValue, onChange, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.key)
  const current = value ?? internal

  const handleClick = (key: string) => {
    if (value === undefined) setInternal(key)
    onChange?.(key)
  }

  return (
    <div className={cn('flex items-center gap-1 border-b border-border', className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          onClick={() => handleClick(item.key)}
          className={cn(
            'relative px-4 h-10 text-sm font-medium transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            current === item.key
              ? 'text-brand'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {item.label}
          {current === item.key && (
            <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-brand" />
          )}
        </button>
      ))}
    </div>
  )
}
