import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle } from 'lucide-react'
import { strategiesApi } from '@/api/strategies'
import { configApi } from '@/api/config'
import { StrategyCard } from '@/components/trading/StrategyCard'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Slider } from '@/components/ui/Slider'
import { Switch } from '@/components/ui/Switch'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/stores/toast'
import { CYCLE_OPTIONS } from '@/utils/constants'
import type {
  Strategy,
  CreateStrategyInput,
  CycleInterval,
  QuantityType,
  StrategyStatus,
} from '@/types'

export function Strategies() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Strategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ strategy: Strategy; status: StrategyStatus } | null>(null)

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: strategiesApi.list,
  })

  const { data: apiConfigs } = useQuery({
    queryKey: ['apiConfigs'],
    queryFn: configApi.getApiConfigs,
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      confirmLive,
    }: {
      id: string | number
      status: StrategyStatus
      confirmLive?: boolean
    }) => strategiesApi.updateStatus(id, status, { confirmLive }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] })
      const labelMap: Partial<Record<StrategyStatus, string>> = {
        RUNNING: '启动',
        PAUSED: '暂停',
        STOPPED: '停止',
        IDLE: '重置',
      }
      toast.success(`策略已${labelMap[vars.status]}`)
      setStatusTarget(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteMutation = useMutation({
    mutationFn: strategiesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] })
      toast.success('策略已删除')
      setDeleteTarget(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const isLiveStrategy = (strategy: Strategy) => strategy.environment === 'LIVE'

  const handleStatusChange = (strategy: Strategy, status: StrategyStatus) => {
    if (status === 'STOPPED') {
      setStatusTarget({ strategy, status })
      return
    }
    if (status === 'RUNNING' && isLiveStrategy(strategy)) {
      setStatusTarget({ strategy, status })
      return
    }
    updateStatusMutation.mutate({ id: strategy.id, status })
  }

  const apiConfigOptions = (apiConfigs ?? []).map((c) => {
    const envLabel = c.environment === 'TESTNET' ? '模拟盘' : '实盘'
    const keyHint = c.apiKeyMasked ? ` · ${c.apiKeyMasked}` : ''
    const acctHint =
      c.exchange === 'LIGHTER' && c.accountIndex != null
        ? ` · acct#${c.accountIndex}`
        : ''
    return {
      label: `${c.name} · ${c.exchange} · ${envLabel}${acctHint}${keyHint}`,
      value: c.id,
      environment: c.environment as 'TESTNET' | 'LIVE',
      exchange: c.exchange,
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">策略管理</h1>
          <p className="text-xs text-fg-muted mt-0.5">创建和管理对冲交易策略</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          创建策略
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-bg-surface border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : strategies && strategies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onStart={() => handleStatusChange(s, 'RUNNING')}
              onPause={() => handleStatusChange(s, 'PAUSED')}
              onStop={() => handleStatusChange(s, 'STOPPED')}
              onEdit={() => setEditTarget(s)}
              onDelete={() => setDeleteTarget(s)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-bg-surface border border-border rounded-lg">
          <EmptyState
            title="暂无策略"
            description="创建您的第一个对冲交易策略，开始自动化交易"
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={16} />
                创建策略
              </Button>
            }
          />
        </div>
      )}

      <StrategyFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        apiConfigOptions={apiConfigOptions}
      />

      {editTarget && (
        <StrategyFormModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          strategy={editTarget}
          apiConfigOptions={apiConfigOptions}
        />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
        title="删除策略"
        danger
        confirmText="确认删除"
        content={
          <p>
            确定要删除策略 <span className="text-fg font-medium">{deleteTarget?.name}</span> 吗？此操作不可恢复，相关持仓需先平仓。
          </p>
        }
      />

      <ConfirmModal
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        onConfirm={() =>
          statusTarget &&
          updateStatusMutation.mutate({
            id: statusTarget.strategy.id,
            status: statusTarget.status,
            confirmLive: statusTarget.status === 'RUNNING',
          })
        }
        loading={updateStatusMutation.isPending}
        title={statusTarget?.status === 'RUNNING' ? '启动实盘策略' : '停止策略'}
        danger
        confirmText={statusTarget?.status === 'RUNNING' ? '确认启动实盘' : '确认停止'}
        content={
          statusTarget?.status === 'RUNNING' ? (
            <div className="space-y-2">
              <p>
                策略 <span className="text-fg font-medium">{statusTarget?.strategy.name}</span> 将在{' '}
                <span className="text-up font-medium">实盘</span> 环境自动开仓，使用真实资金。
              </p>
              <p className="text-warn">请确认 API、数量与风控参数无误后再启动。</p>
            </div>
          ) : (
            <p>
              停止策略 <span className="text-fg font-medium">{statusTarget?.strategy.name}</span> 后，将不再开新单，但已有持仓会保留。确认停止吗？
            </p>
          )
        }
      />
    </div>
  )
}

interface StrategyFormModalProps {
  open: boolean
  onClose: () => void
  strategy?: Strategy
  apiConfigOptions: {
    label: string
    value: string | number
    environment: 'TESTNET' | 'LIVE'
    exchange: string
  }[]
}

function StrategyFormModal({ open, onClose, strategy, apiConfigOptions }: StrategyFormModalProps) {
  const queryClient = useQueryClient()
  const isEdit = !!strategy

  const [form, setForm] = useState<CreateStrategyInput>({
    name: strategy?.name ?? '',
    symbol: strategy?.symbol ?? 'BTCUSDT',
    cycleInterval: strategy?.cycleInterval ?? '5m',
    quantity: strategy?.quantity ?? 1,
    quantityType: strategy?.quantityType ?? 'BY_QUANTITY',
    leverage: strategy?.leverage ?? 10,
    takeProfitPct: strategy?.takeProfitPct ?? 1,
    stopLossPct: strategy?.stopLossPct ?? 1,
    maxPositions: strategy?.maxPositions ?? 10,
    marginMode: strategy?.marginMode ?? 'ISOLATED',
    localAutoCloseEnabled: strategy?.localAutoCloseEnabled ?? false,
    apiConfigId: strategy?.apiConfigId ?? null,
    shortApiConfigId: strategy?.shortApiConfigId ?? null,
  })

  const [submitting, setSubmitting] = useState(false)
  const [liveChecked, setLiveChecked] = useState(false)

  const selectedLong = apiConfigOptions.find(
    (c) => String(c.value) === String(form.apiConfigId ?? ''),
  )
  const selectedConfigEnv =
    selectedLong?.environment ?? strategy?.environment ?? 'TESTNET'
  const environment = selectedConfigEnv
  const isLighter = selectedLong?.exchange === 'LIGHTER'

  const shortOptions = apiConfigOptions.filter(
    (c) =>
      c.exchange === 'LIGHTER' &&
      c.environment === environment &&
      String(c.value) !== String(form.apiConfigId ?? ''),
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('请输入策略名称')
      return
    }
    if (isLighter && !form.shortApiConfigId) {
      toast.error('Lighter 需另选空腿子账户 API 配置（不支持同账户双向持仓）')
      return
    }
    if (environment === 'LIVE' && !liveChecked && !isEdit) {
      toast.warn('请先确认实盘风险')
      return
    }
    if (form.leverage > 50) {
      toast.warn('杠杆超过 50 倍，风险较高')
    }
    setSubmitting(true)
    try {
      const payload: CreateStrategyInput = {
        ...form,
        shortApiConfigId: isLighter ? form.shortApiConfigId : null,
      }
      if (isEdit && strategy) {
        await strategiesApi.update(strategy.id, payload)
        toast.success('策略已更新')
      } else {
        await strategiesApi.create(payload)
        toast.success('策略已创建')
      }
      queryClient.invalidateQueries({ queryKey: ['strategies'] })
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const highLeverage = form.leverage > 50

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '编辑策略' : '创建策略'}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={submitting} form="strategy-form" type="submit">
            {isEdit ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <form id="strategy-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="策略名称"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="例如：BTC 5分钟对冲"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="交易对"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
            placeholder="BTCUSDT"
          />
          <Select
            label="周期"
            value={form.cycleInterval}
            onChange={(e) => setForm({ ...form, cycleInterval: e.target.value as CycleInterval })}
            options={CYCLE_OPTIONS}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-1.5">每单大小类型</label>
            <Tabs
              items={[
                { key: 'BY_QUANTITY', label: '数量 Q' },
                { key: 'BY_NOTIONAL', label: '金额 $' },
              ]}
              value={form.quantityType}
              onChange={(k) => setForm({ ...form, quantityType: k as QuantityType })}
            />
          </div>
          <Input
            label={`每单大小${form.quantityType === 'BY_QUANTITY' ? ' (张)' : ' (USDT)'}`}
            type="number"
            step="0.0001"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-fg-muted">杠杆倍数</label>
            <span className={`text-sm font-mono font-medium ${highLeverage ? 'text-warn' : 'text-fg'}`}>
              {form.leverage}x
            </span>
          </div>
          <Slider
            min={1}
            max={100}
            step={1}
            value={form.leverage}
            onChange={(v) => setForm({ ...form, leverage: v })}
            marks={[
              { value: 1, label: '1x' },
              { value: 25, label: '25x' },
              { value: 50, label: '50x' },
              { value: 75, label: '75x' },
              { value: 100, label: '100x' },
            ]}
          />
          {highLeverage && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-warn">
              <AlertTriangle size={12} />
              杠杆超过 50 倍，存在较高爆仓风险
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="止盈百分比 (%)"
            type="number"
            step="0.01"
            min="0"
            value={form.takeProfitPct}
            onChange={(e) => setForm({ ...form, takeProfitPct: Number(e.target.value) })}
            prefix="↑"
          />
          <Input
            label="止损百分比 (%)"
            type="number"
            step="0.01"
            min="0"
            value={form.stopLossPct}
            onChange={(e) => setForm({ ...form, stopLossPct: Number(e.target.value) })}
            prefix="↓"
          />
        </div>

        <div className="flex items-center justify-between gap-4 p-3 bg-bg-elevated rounded-md">
          <div className="min-w-0">
            <div className="text-sm text-fg">本地主动平仓</div>
            <p className="text-xs text-fg-muted mt-0.5">
              开启后，本地监控价格触及 TP/SL 时主动市价平仓作为保底；关闭则仅依赖交易所条件单。
            </p>
          </div>
          <Switch
            checked={form.localAutoCloseEnabled}
            onChange={(checked) => setForm({ ...form, localAutoCloseEnabled: checked })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="最大持仓数"
            type="number"
            min="1"
            value={form.maxPositions}
            onChange={(e) => setForm({ ...form, maxPositions: Number(e.target.value) })}
          />
          <Select
            label="保证金模式"
            value={form.marginMode}
            onChange={(e) => setForm({ ...form, marginMode: e.target.value as 'CROSSED' | 'ISOLATED' })}
            options={[
              { label: '逐仓 (ISOLATED)', value: 'ISOLATED' },
              { label: '全仓 (CROSSED)', value: 'CROSSED' },
            ]}
          />
        </div>

        <Select
          label={isLighter ? '多腿 API 配置（做多子账户）' : '绑定 API 配置'}
          value={form.apiConfigId ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              apiConfigId: e.target.value || null,
              shortApiConfigId: null,
            })
          }
          options={[
            { label: '不绑定（使用默认）', value: '' },
            ...apiConfigOptions,
          ]}
        />
        {isLighter && (
          <>
            <Select
              label="空腿 API 配置（做空子账户）"
              value={form.shortApiConfigId ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  shortApiConfigId: e.target.value || null,
                })
              }
              options={[
                { label: '请选择空腿子账户', value: '' },
                ...shortOptions,
              ]}
            />
            <p className="text-xs text-warn -mt-2">
              Lighter 不支持同账户双向持仓，需用两个不同 accountIndex 的子账户分别开多/开空。
            </p>
          </>
        )}
        {apiConfigOptions.length > 0 && !isLighter && (
          <p className="text-xs text-fg-subtle -mt-2">
            共 {apiConfigOptions.length} 套可用配置，同交易所可绑定不同账户
          </p>
        )}

        {environment === 'LIVE' && (!isEdit || String(strategy?.apiConfigId ?? '') !== String(form.apiConfigId ?? '')) && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-up/10 border border-up/30 rounded-md">
              <AlertTriangle size={16} className="text-up shrink-0 mt-0.5" />
              <div className="text-xs text-up">
                <div className="font-medium">实盘策略警告</div>
                <div className="mt-1">该策略将绑定实盘环境，启动后使用真实资金开仓。</div>
              </div>
            </div>
            {!isEdit && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={liveChecked}
                  onChange={(e) => setLiveChecked(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-fg-muted">我已知晓实盘风险，确认创建</span>
              </label>
            )}
          </div>
        )}

        <div className="flex items-center justify-between p-3 bg-bg-elevated rounded-md">
          <div>
            <div className="text-sm text-fg">绑定环境</div>
            <div className="text-xs text-fg-muted mt-0.5">
              {environment === 'TESTNET' ? '模拟盘 - 测试环境' : '实盘 - 真实资金'}
              {!form.apiConfigId && '（默认配置）'}
            </div>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded ${
              environment === 'LIVE' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
            }`}
          >
            {environment === 'TESTNET' ? '模拟盘' : '实盘'}
          </span>
        </div>
      </form>
    </Modal>
  )
}
