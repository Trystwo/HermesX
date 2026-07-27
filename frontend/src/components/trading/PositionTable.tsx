import { useMemo } from 'react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, EmptyRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Position } from '@/types'
import { SIDE_LABEL, POSITION_STATUS_LABEL, POSITION_STATUS_VARIANT } from '@/utils/constants'
import {
  formatPrice,
  formatSignedPnl,
  pnlColor,
  formatPositionTime,
} from '@/utils/format'
import { Inbox } from 'lucide-react'

export interface PositionTableProps {
  positions: Position[]
  onClose?: (id: string) => void
  onPlaceTpSl?: (id: string) => void
  placingTpSlId?: string | null
  loading?: boolean
  compact?: boolean
}

function TimeCell({ value, label }: { value?: string | null; label?: string }) {
  if (!value) {
    return (
      <span className="text-fg-muted">
        {label ? `${label} --` : '--'}
      </span>
    )
  }
  return (
    <span className="font-mono">
      {label ? `${label} ` : ''}
      {formatPositionTime(value)}
    </span>
  )
}

export function PositionTable({
  positions,
  onClose,
  onPlaceTpSl,
  placingTpSlId,
  loading,
  compact,
}: PositionTableProps) {
  // 同周期多空成对高亮
  const cyclePairMap = useMemo(() => {
    const map = new Map<string, number>()
    positions.forEach((p) => {
      if (p.status === 'OPEN') {
        map.set(p.cycleId, (map.get(p.cycleId) ?? 0) + 1)
      }
    })
    return map
  }, [positions])

  const showActions = Boolean(onClose || onPlaceTpSl)
  const colSpan = compact ? (showActions ? 8 : 7) : showActions ? 12 : 11

  if (!loading && positions.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={40} strokeWidth={1.5} />}
        title="暂无持仓"
        description="尚未有任何持仓记录"
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>周期ID</TableHead>
          <TableHead>方向</TableHead>
          {!compact && <TableHead>策略</TableHead>}
          <TableHead>开仓价</TableHead>
          <TableHead>当前价</TableHead>
          {!compact && <TableHead>止盈</TableHead>}
          {!compact && <TableHead>止损</TableHead>}
          <TableHead>数量</TableHead>
          <TableHead>未实现盈亏</TableHead>
          {!compact && <TableHead>时间</TableHead>}
          <TableHead>状态</TableHead>
          {showActions && <TableHead className="text-right">操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && positions.length === 0 ? (
          <EmptyRow colSpan={colSpan}>加载中...</EmptyRow>
        ) : (
          positions.map((p) => {
            const isPaired = (cyclePairMap.get(p.cycleId) ?? 0) >= 2
            return (
              <TableRow key={p.id} highlight={isPaired && p.status === 'OPEN'}>
                <TableCell className="font-mono text-xs text-fg-muted">
                  {p.cycleId?.slice(0, 8) ?? '--'}
                </TableCell>
                <TableCell>
                  <Badge variant={p.side === 'LONG' ? 'danger' : 'success'}>
                    {SIDE_LABEL[p.side]}
                  </Badge>
                </TableCell>
                {!compact && (
                  <TableCell className="text-xs text-fg-muted">{p.strategyName ?? p.strategyId}</TableCell>
                )}
                <TableCell className="font-mono">{formatPrice(p.entryPrice)}</TableCell>
                <TableCell className="font-mono">{formatPrice(p.currentPrice)}</TableCell>
                {!compact && (
                  <TableCell className="font-mono text-down">{formatPrice(p.takeProfitPrice)}</TableCell>
                )}
                {!compact && (
                  <TableCell className="font-mono text-up">{formatPrice(p.stopLossPrice)}</TableCell>
                )}
                <TableCell className="font-mono">{p.quantity}</TableCell>
                <TableCell className={`font-mono font-medium ${pnlColor(p.unrealizedPnl)}`}>
                  {formatSignedPnl(p.unrealizedPnl)}
                </TableCell>
                {!compact && (
                  <TableCell className="text-xs text-fg-muted leading-5 whitespace-nowrap">
                    <div><TimeCell label="开仓" value={p.openedAt} /></div>
                    <div><TimeCell label="TP" value={p.tpPlacedAt} /></div>
                    <div><TimeCell label="SL" value={p.slPlacedAt} /></div>
                    {(p.closedAt || p.status !== 'OPEN') && (
                      <div><TimeCell label="平仓" value={p.closedAt} /></div>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge variant={POSITION_STATUS_VARIANT[p.status]}>
                      {POSITION_STATUS_LABEL[p.status]}
                    </Badge>
                    {p.needsTpSl && (
                      <Badge variant="warn">缺TP/SL</Badge>
                    )}
                  </div>
                </TableCell>
                {showActions && (
                  <TableCell className="text-right">
                    {p.status === 'OPEN' && (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {onPlaceTpSl && p.needsTpSl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={placingTpSlId === p.id}
                            onClick={() => onPlaceTpSl(p.id)}
                          >
                            补挂
                          </Button>
                        )}
                        {onClose && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => onClose(p.id)}
                          >
                            平仓
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
