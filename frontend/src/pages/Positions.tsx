import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Search, ShieldPlus, XCircle } from 'lucide-react'
import { positionsApi, PositionFilter, OrphanOrderInfo } from '@/api/positions'
import { strategiesApi } from '@/api/strategies'
import { PositionTable } from '@/components/trading/PositionTable'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { toast } from '@/stores/toast'
import { formatPrice, formatTime } from '@/utils/format'
import type { PositionStatus, Side } from '@/types'

const statusTabs = [
  { key: 'OPEN', label: '持仓中' },
  { key: 'TP_HIT', label: '止盈' },
  { key: 'SL_HIT', label: '止损' },
  { key: 'MANUAL', label: '手动平仓' },
  { key: 'CLOSED', label: '已平仓' },
  { key: 'ALL', label: '全部' },
]

function orphanKindLabel(kind: OrphanOrderInfo['kind']) {
  return kind === 'exchange_orphan' ? '交易所孤儿' : '本地残留'
}

export function Positions() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<string>('OPEN')
  const [strategyId, setStrategyId] = useState<string>('')
  const [side, setSide] = useState<string>('')
  const [closeTarget, setCloseTarget] = useState<string | null>(null)
  const [closeAllOpen, setCloseAllOpen] = useState(false)
  const [batchTpSlOpen, setBatchTpSlOpen] = useState(false)
  const [placingTpSlId, setPlacingTpSlId] = useState<string | null>(null)
  const [orphanReport, setOrphanReport] = useState<OrphanOrderInfo[] | null>(null)

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

  const filteredPositions = useMemo(() => {
    if (!positions) return []
    if (!side) return positions
    return positions.filter((p) => p.side === side)
  }, [positions, side])

  const missingTpSlCount = useMemo(
    () => filteredPositions.filter((p) => p.status === 'OPEN' && p.needsTpSl).length,
    [filteredPositions],
  )

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
    mutationFn: () => positionsApi.closeAll(strategyId || undefined),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
      toast.success(`已平仓 ${res.closed} 个持仓`)
      setCloseAllOpen(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const placeTpSlMutation = useMutation({
    mutationFn: positionsApi.placeTpSl,
    onMutate: (id) => setPlacingTpSlId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('已补挂止盈止损')
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setPlacingTpSlId(null),
  })

  const batchTpSlMutation = useMutation({
    mutationFn: () => positionsApi.placeTpSlMissing(strategyId || undefined),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      const failed = res.attempted - res.succeeded
      if (res.attempted === 0) {
        toast.info('没有需要补挂的持仓')
      } else if (failed === 0) {
        toast.success(`已补挂 ${res.succeeded} 个持仓的 TP/SL`)
      } else {
        toast.error(`补挂完成：成功 ${res.succeeded}，失败 ${failed}`)
      }
      setBatchTpSlOpen(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const checkOrphanMutation = useMutation({
    mutationFn: () => positionsApi.checkOrphanOrders(strategyId || undefined),
    onSuccess: (res) => {
      if (res.orphans.length === 0) {
        setOrphanReport(null)
        toast.success(
          `未发现孤儿单（交易所 ${res.exchangeOpen} / 本地 PENDING ${res.pendingDb}）`,
        )
        return
      }
      setOrphanReport(res.orphans)
      toast.info(`发现 ${res.orphans.length} 笔孤儿单`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const cleanupOrphanMutation = useMutation({
    mutationFn: () =>
      positionsApi.cleanupOrphanOrders(
        strategyId || undefined,
        orphanReport?.map((o) => o.algoId),
      ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      const failed = res.attempted - res.succeeded
      if (failed === 0) {
        toast.success(`已清理 ${res.succeeded} 笔孤儿单`)
      } else {
        toast.error(`清理完成：成功 ${res.succeeded}，失败 ${failed}`)
      }
      setOrphanReport(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">持仓监控</h1>
          <p className="text-xs text-fg-muted mt-0.5">
            实时监控持仓变化；支持补挂止盈止损与手动平仓
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            刷新
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={checkOrphanMutation.isPending}
            onClick={() => checkOrphanMutation.mutate()}
          >
            <Search size={14} />
            检查孤儿单
          </Button>
          {status === 'OPEN' && missingTpSlCount > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setBatchTpSlOpen(true)}>
              <ShieldPlus size={14} />
              批量补挂 ({missingTpSlCount})
            </Button>
          )}
          {status === 'OPEN' && filteredPositions.length > 0 && (
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
              ...(strategies ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
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
            共 {filteredPositions.length} 条
            {missingTpSlCount > 0 && (
              <span className="text-warn ml-2">缺 TP/SL {missingTpSlCount}</span>
            )}
          </div>
        </div>

        <div className="p-2">
          <PositionTable
            positions={filteredPositions}
            loading={isLoading}
            onClose={(id) => setCloseTarget(id)}
            onPlaceTpSl={(id) => placeTpSlMutation.mutate(id)}
            placingTpSlId={placingTpSlId}
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
            确定要平掉持仓{' '}
            <span className="text-fg font-mono">#{closeTarget?.slice(0, 8)}</span> 吗？平仓后无法撤销。
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
            <p>
              当前有 <span className="text-fg font-medium">{filteredPositions.length}</span> 个持仓，确定全部平仓吗？
            </p>
          </div>
        }
      />

      <ConfirmModal
        open={batchTpSlOpen}
        onClose={() => setBatchTpSlOpen(false)}
        onConfirm={() => batchTpSlMutation.mutate()}
        loading={batchTpSlMutation.isPending}
        title="批量补挂止盈止损"
        confirmText="确认补挂"
        content={
          <div className="space-y-2">
            <p>
              将为 <span className="text-fg font-medium">{missingTpSlCount}</span> 个缺少 TP/SL
              挂单的持仓重新挂止盈止损（先取消残留挂单再按策略参数重挂）。
            </p>
            {strategyId && <p className="text-xs text-fg-muted">仅处理当前筛选策略下的缺失仓位。</p>}
            <p className="text-xs text-fg-muted">
              若交易所仍报条件单上限（-4045），请先到交易所取消多余条件单后再试。
            </p>
          </div>
        }
      />

      <Modal
        open={orphanReport !== null && orphanReport.length > 0}
        onClose={() => !cleanupOrphanMutation.isPending && setOrphanReport(null)}
        title={`发现 ${orphanReport?.length ?? 0} 笔孤儿单`}
        width={720}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={cleanupOrphanMutation.isPending}
              onClick={() => setOrphanReport(null)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={cleanupOrphanMutation.isPending}
              onClick={() => cleanupOrphanMutation.mutate()}
            >
              确认清理
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            以下挂单与本地 PENDING 不一致。确认后将撤销交易所残留条件单，并清理本地残留 PENDING。
            {strategyId ? '（按当前筛选策略对应账户/交易对扫描）' : ''}
          </p>
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-bg-elevated text-fg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">类型</th>
                  <th className="text-left px-3 py-2 font-medium">策略</th>
                  <th className="text-left px-3 py-2 font-medium">方向</th>
                  <th className="text-left px-3 py-2 font-medium">触发价</th>
                  <th className="text-left px-3 py-2 font-medium">algoId</th>
                  <th className="text-left px-3 py-2 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {(orphanReport ?? []).map((o) => (
                  <tr key={`${o.kind}-${o.algoId}`} className="border-t border-border">
                    <td className="px-3 py-2 text-fg">{orphanKindLabel(o.kind)}</td>
                    <td className="px-3 py-2 text-fg">{o.strategyName}</td>
                    <td className="px-3 py-2 text-fg">
                      {(o.positionSide || o.side || '--').toUpperCase()} / {o.orderType}
                    </td>
                    <td className="px-3 py-2 font-mono text-fg">{formatPrice(o.triggerPrice)}</td>
                    <td className="px-3 py-2 font-mono text-fg-muted">{o.algoId}</td>
                    <td className="px-3 py-2 text-fg-muted whitespace-nowrap">
                      {formatTime(o.createTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  )
}
