import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { StatsCards } from '@/components/trading/StatsCards'
import { KlineChart } from '@/components/trading/KlineChart'
import { PnlChart } from '@/components/trading/PnlChart'
import { PositionTable } from '@/components/trading/PositionTable'
import { EnvironmentBadge } from '@/components/trading/EnvironmentBadge'
import { positionsApi } from '@/api/positions'
import { statsApi } from '@/api/stats'
import { marketApi } from '@/api/market'
import { accountApi } from '@/api/account'
import { strategiesApi } from '@/api/strategies'
import { useAppStore } from '@/stores/app'
import { STATUS_LABEL } from '@/utils/constants'
import { TrendingUp, Trophy, Activity, Wallet, LineChart } from 'lucide-react'

export function Dashboard() {
  const { selectedStrategyId, setSelectedStrategyId } = useAppStore()
  const [interval, setInterval] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('15m')

  const { data: strategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  // 默认选中第一个活跃策略，否则第一个策略
  useEffect(() => {
    if (!strategies?.length) return
    const exists = strategies.some((s) => String(s.id) === selectedStrategyId)
    if (selectedStrategyId && exists) return
    const preferred =
      strategies.find((s) => s.isActive || s.status === 'RUNNING' || s.status === 'MONITORING') ??
      strategies[0]
    setSelectedStrategyId(String(preferred.id))
  }, [strategies, selectedStrategyId, setSelectedStrategyId])

  const selectedStrategy = strategies?.find((s) => String(s.id) === selectedStrategyId)
  const symbol = selectedStrategy?.symbol ?? 'BTCUSDT'

  useEffect(() => {
    if (selectedStrategy?.cycleInterval) {
      const iv = selectedStrategy.cycleInterval
      if (['1m', '5m', '15m', '1h', '4h', '1d'].includes(iv)) {
        setInterval(iv as typeof interval)
      }
    }
  }, [selectedStrategy?.id, selectedStrategy?.cycleInterval])

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats', 'dashboard', selectedStrategyId],
    queryFn: () =>
      statsApi.getStats({ range: 'WEEK', strategyId: selectedStrategyId! }),
    enabled: !!selectedStrategyId,
  })

  const { data: balance } = useQuery({
    queryKey: ['balance', selectedStrategyId],
    queryFn: () => accountApi.getBalance({ strategyId: selectedStrategyId! }),
    enabled: !!selectedStrategyId,
    refetchInterval: 10000,
  })

  const { data: positions } = useQuery({
    queryKey: ['positions', 'OPEN', selectedStrategyId],
    queryFn: () =>
      positionsApi.list({ status: 'OPEN', strategyId: selectedStrategyId! }),
    enabled: !!selectedStrategyId,
    refetchInterval: 5000,
  })

  const { data: klines } = useQuery({
    queryKey: ['klines', symbol, interval],
    queryFn: () => marketApi.getKlines(symbol, interval, 100),
    enabled: !!selectedStrategyId,
    refetchInterval: 10000,
  })

  const totalPnl = (stats?.totalPnl ?? 0) + (balance?.unrealizedPnl ?? 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-fg">仪表盘</h1>
          <p className="text-xs text-fg-muted mt-0.5">按策略查看账户、持仓和盈亏状态</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={selectedStrategyId ?? ''}
            onChange={(e) => setSelectedStrategyId(e.target.value || null)}
            options={(strategies ?? []).map((s) => ({
              label: s.name,
              value: String(s.id),
            }))}
            className="h-9 w-48"
          />
          {selectedStrategy && (
            <>
              <EnvironmentBadge environment={selectedStrategy.environment} size="sm" />
              <span className="text-xs text-fg-muted px-2 h-8 inline-flex items-center rounded-md bg-bg-elevated border border-border">
                {STATUS_LABEL[selectedStrategy.status] ?? selectedStrategy.status}
              </span>
            </>
          )}
        </div>
      </div>

      {!selectedStrategyId ? (
        <div className="py-16 text-center text-sm text-fg-subtle">
          {strategies && strategies.length === 0
            ? '暂无策略，请先在策略管理中创建'
            : '请选择策略以查看状态'}
        </div>
      ) : (
        <>
          <StatsCards
            columns={4}
            loading={statsLoading}
            items={[
              {
                label: '总盈亏',
                value: totalPnl,
                isCurrency: true,
                positive: totalPnl >= 0,
                icon: <TrendingUp size={16} />,
                color: totalPnl >= 0 ? 'up' : 'down',
              },
              {
                label: '胜率',
                value: stats?.winRate ?? 0,
                isPct: true,
                icon: <Trophy size={16} />,
                color: 'default',
              },
              {
                label: '活跃持仓',
                value: positions?.length ?? 0,
                suffix: ' 个',
                icon: <Activity size={16} />,
                color: 'default',
              },
              {
                label: '账户余额',
                value: balance?.totalBalance ?? 0,
                isCurrency: true,
                icon: <Wallet size={16} />,
                color: 'default',
              },
            ]}
          />

          <Card
            title={
              <div className="flex items-center gap-3">
                <span>K线图</span>
                <span className="text-xs text-fg-muted font-mono">{symbol}</span>
              </div>
            }
            extra={
              <Select
                value={interval}
                onChange={(e) => setInterval(e.target.value as typeof interval)}
                options={[
                  { label: '1m', value: '1m' },
                  { label: '5m', value: '5m' },
                  { label: '15m', value: '15m' },
                  { label: '1h', value: '1h' },
                  { label: '4h', value: '4h' },
                  { label: '1d', value: '1d' },
                ]}
                className="h-8 w-20"
              />
            }
            noPadding
          >
            <div className="p-2">
              {klines && klines.length > 0 ? (
                <KlineChart data={klines} positions={positions ?? []} height={400} />
              ) : (
                <div className="h-[400px] flex items-center justify-center text-fg-subtle text-sm">
                  加载K线数据中...
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="活跃持仓"
              extra={
                <span className="text-xs text-fg-muted">{positions?.length ?? 0} 个</span>
              }
            >
              {positions && positions.length > 0 ? (
                <PositionTable positions={positions.slice(0, 5)} compact />
              ) : (
                <div className="text-center text-sm text-fg-subtle py-8">暂无活跃持仓</div>
              )}
            </Card>

            <Card
              title="盈亏曲线（近 7 天）"
              extra={<LineChart size={14} className="text-fg-muted" />}
            >
              {stats?.dailyPnl && stats.dailyPnl.length > 0 ? (
                <PnlChart data={stats.dailyPnl} height={280} />
              ) : (
                <div className="h-[280px] flex items-center justify-center text-fg-subtle text-sm">
                  暂无盈亏数据
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
