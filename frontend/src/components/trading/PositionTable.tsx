import { useMemo } from 'react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, EmptyRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Position } from '@/types'
import { SIDE_LABEL, POSITION_STATUS_LABEL, POSITION_STATUS_VARIANT } from '@/utils/constants'
import { formatPrice, formatSignedPnl, pnlColor, formatTimeShort } from '@/utils/format'
import { Inbox } from 'lucide-react'

export interface PositionTableProps {
  positions: Position[]
  onClose?: (id: number) => void
  loading?: boolean
  compact?: boolean
}

export function PositionTable({ positions, onClose, loading, compact }: PositionTableProps) {
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
          {!compact && <TableHead>开仓时间</TableHead>}
          <TableHead>状态</TableHead>
          {onClose && <TableHead className="text-right">操作</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && positions.length === 0 ? (
          <EmptyRow colSpan={onClose ? 11 : 10}>加载中...</EmptyRow>
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
                  <TableCell className="text-xs text-fg-muted">
                    {formatTimeShort(p.openedAt)}
                  </TableCell>
                )}
                <TableCell>
                  <Badge variant={POSITION_STATUS_VARIANT[p.status]}>
                    {POSITION_STATUS_LABEL[p.status]}
                  </Badge>
                </TableCell>
                {onClose && (
                  <TableCell className="text-right">
                    {p.status === 'OPEN' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onClose(p.id)}
                      >
                        平仓
                      </Button>
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
