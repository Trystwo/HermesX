import { ReactNode } from 'react'
import { TrendingUp, Trophy, AlertCircle, Wallet, Activity } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatCurrency, formatPct, formatNumber } from '@/utils/format'

export interface StatItem {
  label: string
  value: number
  suffix?: string
  isPct?: boolean
  isCurrency?: boolean
  positive?: boolean
  icon?: ReactNode
  color?: string
}

export interface StatsCardsProps {
  items: StatItem[]
  columns?: 2 | 3 | 4
  loading?: boolean
}

const iconMap = {
  pnl: <TrendingUp size={16} />,
  winRate: <Trophy size={16} />,
  positions: <Activity size={16} />,
  drawdown: <AlertCircle size={16} />,
  balance: <Wallet size={16} />,
}

export function StatsCards({ items, columns = 4, loading }: StatsCardsProps) {
  const colClass = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
  }[columns]

  return (
    <div className={cn('grid gap-3', colClass)}>
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-bg-surface p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">{item.label}</span>
            {item.icon && (
              <span
                className={cn(
                  'p-1 rounded',
                  item.color === 'up' && 'bg-up/10 text-up',
                  item.color === 'down' && 'bg-down/10 text-down',
                  (!item.color || item.color === 'default') && 'bg-bg-hover text-fg-muted',
                  item.color === 'warn' && 'bg-warn/10 text-warn',
                )}
              >
                {item.icon}
              </span>
            )}
          </div>
          {loading ? (
            <div className="h-7 bg-bg-hover rounded animate-pulse" />
          ) : (
            <div
              className={cn(
                'text-xl font-semibold font-mono tabular-nums',
                item.positive === true && 'text-up',
                item.positive === false && 'text-down',
              )}
            >
              {item.isCurrency
                ? formatCurrency(item.value)
                : item.isPct
                  ? formatPct(item.value)
                  : `${formatNumber(item.value)}${item.suffix ?? ''}`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export { iconMap }
