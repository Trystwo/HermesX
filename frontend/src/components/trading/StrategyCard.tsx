import { useMemo } from 'react'
import { Play, Pause, Square, Trash2, Settings2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EnvironmentBadge } from './EnvironmentBadge'
import type { Strategy } from '@/types'
import { CYCLE_OPTIONS, STATUS_LABEL, STATUS_VARIANT } from '@/utils/constants'
import { formatPct } from '@/utils/format'

export interface StrategyCardProps {
  strategy: Strategy
  onStart?: () => void
  onPause?: () => void
  onStop?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function StrategyCard({
  strategy,
  onStart,
  onPause,
  onStop,
  onEdit,
  onDelete,
}: StrategyCardProps) {
  const cycleLabel = useMemo(
    () => CYCLE_OPTIONS.find((c) => c.value === strategy.cycleInterval)?.label ?? strategy.cycleInterval,
    [strategy.cycleInterval],
  )

  const highLeverage = strategy.leverage > 50
  const isRunning =
    strategy.isActive === true ||
    ['RUNNING', 'ARMED', 'OPENING', 'MONITORING', 'CLOSING'].includes(strategy.status)

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg truncate">{strategy.name}</h3>
            <EnvironmentBadge environment={strategy.environment} size="sm" />
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-fg-muted">
            <span className="font-mono">{strategy.symbol}</span>
            <span>·</span>
            <span>{cycleLabel}</span>
            <span>·</span>
            <span className={highLeverage ? 'text-warn font-medium' : ''}>
              {strategy.leverage}x
            </span>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[strategy.status] ?? 'neutral'}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
          {STATUS_LABEL[strategy.status] ?? strategy.status}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="bg-bg-elevated rounded p-2">
          <div className="text-fg-subtle">止盈</div>
          <div className="text-down font-medium mt-0.5">{formatPct(strategy.takeProfitPct)}</div>
        </div>
        <div className="bg-bg-elevated rounded p-2">
          <div className="text-fg-subtle">止损</div>
          <div className="text-up font-medium mt-0.5">{formatPct(strategy.stopLossPct)}</div>
        </div>
        <div className="bg-bg-elevated rounded p-2">
          <div className="text-fg-subtle">单量</div>
          <div className="text-fg font-medium mt-0.5">
            {strategy.quantity}
            <span className="text-fg-subtle ml-0.5">
              {strategy.quantityType === 'BY_QUANTITY' ? 'Q' : '$'}
            </span>
          </div>
        </div>
        <div className="bg-bg-elevated rounded p-2">
          <div className="text-fg-subtle">上限</div>
          <div className="text-fg font-medium mt-0.5">{strategy.maxPositions}</div>
        </div>
      </div>

      {strategy.localAutoCloseEnabled && (
        <div className="text-xs text-fg-muted bg-bg-elevated rounded px-2 py-1.5">
          本地主动平仓已开启
        </div>
      )}

      {highLeverage && (
        <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
          杠杆超过 50 倍，存在较高爆仓风险
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-1 border-t border-border">
        {!isRunning && (
          <Button size="sm" variant="primary" onClick={onStart} className="flex-1">
            <Play size={14} />
            启动
          </Button>
        )}
        {isRunning && (
          <Button size="sm" variant="secondary" onClick={onPause} className="flex-1">
            <Pause size={14} />
            暂停
          </Button>
        )}
        {(isRunning || strategy.status === 'PAUSED') && (
          <Button size="sm" variant="ghost" onClick={onStop} title="停止">
            <Square size={14} />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit} title="编辑">
          <Settings2 size={14} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="删除" className="text-up hover:text-up">
          <Trash2 size={14} />
        </Button>
      </div>
    </Card>
  )
}
