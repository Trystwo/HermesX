import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatsCards } from '@/components/trading/StatsCards'
import { PnlChart } from '@/components/trading/PnlChart'
import { statsApi } from '@/api/stats'
import { TrendingUp, Trophy, Scale, AlertCircle } from 'lucide-react'
import { formatCurrency, formatNumber, formatSignedPnl, pnlColor, formatDate } from '@/utils/format'

export function Stats() {
  const [range, setRange] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK')

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', range],
    queryFn: () => statsApi.getStats({ range }),
  })

  const profitFactor = stats?.profitFactor ?? 0
  const avgWin = stats?.avgWin ?? 0
  const avgLoss = stats?.avgLoss ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">统计分析</h1>
          <p className="text-xs text-fg-muted mt-0.5">查看交易表现和盈亏明细</p>
        </div>
        <Tabs
          items={[
            { key: 'DAY', label: '今日' },
            { key: 'WEEK', label: '本周' },
            { key: 'MONTH', label: '本月' },
          ]}
          value={range}
          onChange={(k) => setRange(k as typeof range)}
        />
      </div>

      <StatsCards
        columns={4}
        loading={isLoading}
        items={[
          {
            label: '总盈亏',
            value: stats?.totalPnl ?? 0,
            isCurrency: true,
            positive: (stats?.totalPnl ?? 0) >= 0,
            icon: <TrendingUp size={16} />,
            color: (stats?.totalPnl ?? 0) >= 0 ? 'up' : 'down',
          },
          {
            label: '胜率',
            value: stats?.winRate ?? 0,
            isPct: true,
            icon: <Trophy size={16} />,
            color: 'default',
          },
          {
            label: '盈亏比',
            value: profitFactor,
            icon: <Scale size={16} />,
            color: profitFactor >= 1 ? 'up' : 'down',
          },
          {
            label: '最大回撤',
            value: stats?.maxDrawdown ?? 0,
            isPct: true,
            positive: false,
            icon: <AlertCircle size={16} />,
            color: 'warn',
          },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <div className="text-xs text-fg-muted">总交易数</div>
          <div className="text-lg font-mono mt-1">{stats?.totalTrades ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs text-fg-muted">盈利次数</div>
          <div className="text-lg font-mono mt-1 text-up">{stats?.winTrades ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs text-fg-muted">亏损次数</div>
          <div className="text-lg font-mono mt-1 text-down">{stats?.lossTrades ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs text-fg-muted">活跃持仓</div>
          <div className="text-lg font-mono mt-1">{stats?.activePositions ?? 0}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <div className="text-xs text-fg-muted">平均盈利</div>
          <div className="text-lg font-mono mt-1 text-up">{formatCurrency(avgWin)}</div>
        </Card>
        <Card>
          <div className="text-xs text-fg-muted">平均亏损</div>
          <div className="text-lg font-mono mt-1 text-down">{formatCurrency(avgLoss)}</div>
        </Card>
      </div>

      {/* 盈亏曲线 */}
      <Card title="盈亏曲线">
        {stats?.dailyPnl && stats.dailyPnl.length > 0 ? (
          <PnlChart data={stats.dailyPnl} height={320} />
        ) : (
          <div className="h-[320px] flex items-center justify-center">
            <EmptyState title="暂无盈亏数据" />
          </div>
        )}
      </Card>

      {/* 每日盈亏明细 */}
      <Card title="每日盈亏明细" noPadding>
        <div className="p-2">
          {!stats?.dailyPnl || stats.dailyPnl.length === 0 ? (
            <EmptyState title="暂无明细数据" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>当日盈亏</TableHead>
                  <TableHead>累计盈亏</TableHead>
                  <TableHead>交易数</TableHead>
                  <TableHead>盈亏比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...stats.dailyPnl].reverse().map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="font-mono text-xs">{formatDate(d.date)}</TableCell>
                    <TableCell className={`font-mono font-medium ${pnlColor(d.pnl)}`}>
                      {formatSignedPnl(d.pnl)}
                    </TableCell>
                    <TableCell className={`font-mono ${pnlColor(d.cumulative)}`}>
                      {formatSignedPnl(d.cumulative)}
                    </TableCell>
                    <TableCell className="font-mono">{d.trades}</TableCell>
                    <TableCell className="font-mono">
                      {d.trades > 0 ? formatNumber(d.pnl / d.trades, 2) : '--'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  )
}
