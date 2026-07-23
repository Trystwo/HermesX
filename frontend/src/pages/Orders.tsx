import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { ordersApi } from '@/api/orders'
import { strategiesApi } from '@/api/strategies'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { SIDE_LABEL } from '@/utils/constants'
import { formatTime, formatPrice, formatNumber } from '@/utils/format'
import type { OrderStatus, OrderType } from '@/types'

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  OPEN: '开仓',
  TP: '止盈平仓',
  SL: '止损平仓',
  MANUAL_CLOSE: '手动平仓',
  CLOSE_ALL: '一键平仓',
}

const ORDER_STATUS_VARIANT: Record<OrderStatus, 'info' | 'success' | 'warn' | 'danger'> = {
  PENDING: 'warn',
  FILLED: 'success',
  CANCELED: 'neutral' as never,
  FAILED: 'danger',
}

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: '待成交',
  FILLED: '已成交',
  CANCELED: '已取消',
  FAILED: '失败',
}

export function Orders() {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [status, setStatus] = useState<string>('')
  const [strategyId, setStrategyId] = useState<string>('')

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['orders', { page, pageSize, status, strategyId }],
    queryFn: () =>
      ordersApi.list({
        page,
        pageSize,
        status: status ? (status as OrderStatus) : undefined,
        strategyId: strategyId || undefined,
      }),
  })

  const { data: strategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">订单历史</h1>
          <p className="text-xs text-fg-muted mt-0.5">查看所有订单成交记录</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          刷新
        </Button>
      </div>

      <Card noPadding>
        <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
          <Select
            value={strategyId}
            onChange={(e) => {
              setStrategyId(e.target.value)
              setPage(1)
            }}
            options={[
              { label: '全部策略', value: '' },
              ...(strategies ?? []).map((s) => ({ label: s.name, value: s.id })),
            ]}
            className="h-8 w-40"
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            options={[
              { label: '全部状态', value: '' },
              { label: '待成交', value: 'PENDING' },
              { label: '已成交', value: 'FILLED' },
              { label: '已取消', value: 'CANCELED' },
              { label: '失败', value: 'FAILED' },
            ]}
            className="h-8 w-32"
          />
          <div className="ml-auto text-xs text-fg-muted">
            共 {total} 条
          </div>
        </div>

        <div className="p-2">
          {isLoading ? (
            <div className="py-12 text-center text-fg-subtle text-sm">加载中...</div>
          ) : items.length === 0 ? (
            <EmptyState title="暂无订单" description="尚未有订单成交记录" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>策略</TableHead>
                  <TableHead>交易对</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>价格</TableHead>
                  <TableHead>成交价</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs text-fg-muted">{formatTime(o.createdAt)}</TableCell>
                    <TableCell className="text-xs">{o.strategyName ?? o.strategyId}</TableCell>
                    <TableCell className="font-mono">{o.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={o.side === 'LONG' ? 'danger' : 'success'}>
                        {SIDE_LABEL[o.side]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{ORDER_TYPE_LABEL[o.type]}</TableCell>
                    <TableCell className="font-mono">{formatNumber(o.quantity, 4)}</TableCell>
                    <TableCell className="font-mono">{formatPrice(o.price)}</TableCell>
                    <TableCell className="font-mono">
                      {o.avgFillPrice ? formatPrice(o.avgFillPrice) : '--'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ORDER_STATUS_VARIANT[o.status]}>
                        {ORDER_STATUS_LABEL[o.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 h-12 border-t border-border">
            <span className="text-xs text-fg-muted">
              第 {page} / {totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
                上一页
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
