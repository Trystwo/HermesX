import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, XCircle } from 'lucide-react'
import { positionsApi, PositionFilter } from '@/api/positions'
import { strategiesApi } from '@/api/strategies'
import { PositionTable } from '@/components/trading/PositionTable'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmModal } from '@/components/ui/Modal'
import { toast } from '@/stores/toast'
import type { PositionStatus, Side } from '@/types'

const statusTabs = [
  { key: 'OPEN', label: '持仓中' },
  { key: 'TP_HIT', label: '止盈' },
  { key: 'SL_HIT', label: '止损' },
  { key: 'MANUAL', label: '手动平仓' },
  { key: 'CLOSED', label: '已平仓' },
  { key: 'ALL', label: '全部' },
]

export function Positions() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<string>('OPEN')
  const [strategyId, setStrategyId] = useState<string>('')
  const [side, setSide] = useState<string>('')
  const [closeTarget, setCloseTarget] = useState<number | null>(null)
  const [closeAllOpen, setCloseAllOpen] = useState(false)

  const filter: PositionFilter = {
    status: status === 'ALL' ? undefined : (status as PositionStatus),
    strategyId: strategyId || undefined,
    side: side ? (side as Side) : undefined,
  }

  const { data: positions, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['positions', filter],
    queryFn: () => positionsApi.list(filter),
    refetchInterval: status === 'OPEN' ? 5000 : false,
  })

  const { data: strategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const closeMutation = useMutation({
    mutationFn: positionsApi.close,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
      toast.success('平仓成功')
      setCloseTarget(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const closeAllMutation = useMutation({
    mutationFn: positionsApi.closeAll,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
      toast.success(`已平仓 ${res.closed} 个持仓`)
      setCloseAllOpen(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">持仓监控</h1>
          <p className="text-xs text-fg-muted mt-0.5">实时监控持仓变化，支持手动平仓</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            刷新
          </Button>
          {status === 'OPEN' && positions && positions.length > 0 && (
            <Button variant="danger" size="sm" onClick={() => setCloseAllOpen(true)}>
              <XCircle size={14} />
              一键平仓
            </Button>
          )}
        </div>
      </div>

      <Card noPadding>
        <div className="p-3 border-b border-border">
          <Tabs items={statusTabs} value={status} onChange={setStatus} />
        </div>

        <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
          <Select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            options={[
              { label: '全部策略', value: '' },
              ...(strategies ?? []).map((s) => ({ label: s.name, value: s.id })),
            ]}
            className="h-8 w-40"
          />
          <Select
            value={side}
            onChange={(e) => setSide(e.target.value)}
            options={[
              { label: '全部方向', value: '' },
              { label: '多 (LONG)', value: 'LONG' },
              { label: '空 (SHORT)', value: 'SHORT' },
            ]}
            className="h-8 w-32"
          />
          <div className="ml-auto text-xs text-fg-muted">
            共 {positions?.length ?? 0} 条
          </div>
        </div>

        <div className="p-2">
          <PositionTable
            positions={positions ?? []}
            loading={isLoading}
            onClose={(id) => setCloseTarget(id)}
          />
        </div>
      </Card>

      <ConfirmModal
        open={closeTarget !== null}
        onClose={() => setCloseTarget(null)}
        onConfirm={() => closeTarget && closeMutation.mutate(closeTarget)}
        loading={closeMutation.isPending}
        title="手动平仓"
        danger
        confirmText="确认平仓"
        content={
          <p>
            确定要平掉持仓 <span className="text-fg font-mono">#{closeTarget}</span> 吗？平仓后无法撤销。
          </p>
        }
      />

      <ConfirmModal
        open={closeAllOpen}
        onClose={() => setCloseAllOpen(false)}
        onConfirm={() => closeAllMutation.mutate()}
        loading={closeAllMutation.isPending}
        title="一键平仓"
        danger
        confirmText="全部平仓"
        content={
          <div className="space-y-2">
            <p className="text-up font-medium">此操作将平掉所有持仓中的仓位。</p>
            <p>当前有 <span className="text-fg font-medium">{positions?.length ?? 0}</span> 个持仓，确定全部平仓吗？</p>
          </div>
        }
      />
    </div>
  )
}
