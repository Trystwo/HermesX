import { useState, FormEvent, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Plug, ShieldCheck, AlertTriangle, KeyRound } from 'lucide-react'
import { configApi, type RiskParams } from '@/api/config'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/stores/toast'
import { EXCHANGES } from '@/utils/constants'
import { formatTime } from '@/utils/format'
import type { Environment, CreateApiConfigInput } from '@/types'

export function Settings() {
  const queryClient = useQueryClient()

  const { data: configs, isLoading } = useQuery({
    queryKey: ['apiConfigs'],
    queryFn: configApi.getApiConfigs,
  })

  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string | number
    exchange: string
    environment: Environment
  } | null>(null)
  const [testing, setTesting] = useState<Environment | null>(null)

  const testMutation = useMutation({
    mutationFn: configApi.testConnection,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`连接成功 · 延迟 ${res.latency ?? '--'}ms`)
      } else {
        toast.error(`连接失败: ${res.message}`)
      }
      setTesting(null)
      queryClient.invalidateQueries({ queryKey: ['apiConfigs'] })
    },
    onError: (e) => {
      toast.error((e as Error).message)
      setTesting(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: configApi.deleteApiConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiConfigs'] })
      toast.success('API 配置已删除')
      setDeleteTarget(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const handleTest = (env: Environment) => {
    setTesting(env)
    testMutation.mutate(env)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-fg">设置</h1>
        <p className="text-xs text-fg-muted mt-0.5">管理 API 配置和风控参数</p>
      </div>

      {/* API 配置 */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <KeyRound size={16} />
            API 配置
          </div>
        }
        extra={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} />
            添加配置
          </Button>
        }
        noPadding
      >
        <div className="p-2">
          {isLoading ? (
            <div className="py-8 text-center text-fg-subtle text-sm">加载中...</div>
          ) : !configs || configs.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={40} strokeWidth={1.5} />}
              title="暂无 API 配置"
              description="添加交易所 API 配置后才能进行实盘/模拟交易"
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus size={14} />
                  添加配置
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-bg-hover/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {EXCHANGES.find((e) => e.value === c.exchange)?.label ?? c.exchange}
                      </span>
                      <Badge variant={c.environment === 'LIVE' ? 'danger' : 'success'}>
                        {c.environment === 'LIVE' ? '实盘' : '模拟盘'}
                      </Badge>
                      {c.status === 'ACTIVE' && (
                        <Badge variant="success">
                          <ShieldCheck size={10} />
                          可用
                        </Badge>
                      )}
                      {c.status === 'INVALID' && (
                        <Badge variant="danger">
                          <AlertTriangle size={10} />
                          失效
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-fg-muted">
                      <span className="font-mono">{c.apiKeyMasked}</span>
                      <span className="text-fg-subtle">|</span>
                      <span className="font-mono">{c.apiSecretMasked}</span>
                    </div>
                    {c.lastTestedAt && (
                      <div className="text-[10px] text-fg-subtle mt-1">
                        上次测试：{formatTime(c.lastTestedAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={testing === c.environment}
                      onClick={() => handleTest(c.environment)}
                    >
                      <Plug size={14} />
                      测试
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-up hover:text-up"
                      onClick={() =>
                        setDeleteTarget({
                          id: c.id,
                          exchange: c.exchange,
                          environment: c.environment,
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 风控参数 */}
      <Card title="风控参数">
        <RiskParamsSection />
      </Card>

      <AddApiConfigModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
        title="删除 API 配置"
        danger
        confirmText="确认删除"
        content={
          <p>
            确定要删除 <span className="text-fg font-medium">{deleteTarget?.exchange}</span>（
            {deleteTarget?.environment === 'LIVE' ? '实盘' : '模拟盘'}）的 API 配置吗？
            绑定该配置的策略将无法继续交易。
          </p>
        }
      />
    </div>
  )
}

function AddApiConfigModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateApiConfigInput>({
    exchange: 'BINANCE',
    environment: 'TESTNET',
    apiKey: '',
    apiSecret: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [liveChecked, setLiveChecked] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.apiKey.trim() || !form.apiSecret.trim()) {
      toast.error('请填写完整的 API Key 和 Secret')
      return
    }
    if (form.environment === 'LIVE' && !liveChecked) {
      toast.warn('请先确认实盘风险')
      return
    }
    setSubmitting(true)
    try {
      await configApi.createApiConfig(form)
      queryClient.invalidateQueries({ queryKey: ['apiConfigs'] })
      toast.success('API 配置已添加')
      setForm({ exchange: 'BINANCE', environment: 'TESTNET', apiKey: '', apiSecret: '' })
      setLiveChecked(false)
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="添加 API 配置"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={submitting} form="api-config-form" type="submit">
            添加
          </Button>
        </>
      }
    >
      <form id="api-config-form" onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="交易所"
          value={form.exchange}
          onChange={(e) => setForm({ ...form, exchange: e.target.value })}
          options={EXCHANGES}
        />

        <Select
          label="环境"
          value={form.environment}
          onChange={(e) => setForm({ ...form, environment: e.target.value as Environment })}
          options={[
            { label: '模拟盘 (TESTNET)', value: 'TESTNET' },
            { label: '实盘 (LIVE)', value: 'LIVE' },
          ]}
        />

        <Input
          label="API Key"
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          placeholder="输入你的 API Key"
        />

        <Input
          label="API Secret"
          type="password"
          value={form.apiSecret}
          onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
          placeholder="输入你的 API Secret"
        />

        {form.environment === 'LIVE' && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-up/10 border border-up/30 rounded-md">
              <AlertTriangle size={16} className="text-up shrink-0 mt-0.5" />
              <div className="text-xs text-up">
                <div className="font-medium">实盘警告</div>
                <div className="mt-1">实盘 API 将使用真实资金进行交易，请确保您了解所有风险。建议先在模拟盘测试策略。</div>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={liveChecked}
                onChange={(e) => setLiveChecked(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-fg-muted">
                我已知晓实盘交易风险，确认添加实盘 API 配置
              </span>
            </label>
          </div>
        )}

        <div className="text-xs text-fg-subtle bg-bg-elevated rounded p-3">
          <div className="font-medium text-fg-muted mb-1">安全提示</div>
          · API 密钥将加密存储，不会以明文显示<br />
          · 建议只开启合约交易权限，不要开启提现权限<br />
          · 请限制 IP 访问以提高安全性
        </div>
      </form>
    </Modal>
  )
}

function RiskParamsSection() {
  const queryClient = useQueryClient()
  const { data: riskParams, isLoading } = useQuery({
    queryKey: ['riskParams'],
    queryFn: configApi.getRiskParams,
  })
  const [form, setForm] = useState<Partial<RiskParams>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (riskParams) {
      setForm({
        maxTotalLossPct: riskParams.maxTotalLossPct,
        maxConsecutiveLosses: riskParams.maxConsecutiveLosses,
        maxPositions: riskParams.maxPositions,
        maxSingleNotional: riskParams.maxSingleNotional,
      })
    }
  }, [riskParams])

  const handleSave = async () => {
    const {
      maxTotalLossPct,
      maxConsecutiveLosses,
      maxPositions,
      maxSingleNotional,
    } = form
    if (
      maxTotalLossPct == null ||
      !Number.isFinite(maxTotalLossPct) ||
      maxTotalLossPct <= 0 ||
      maxConsecutiveLosses == null ||
      !Number.isFinite(maxConsecutiveLosses) ||
      maxConsecutiveLosses <= 0 ||
      maxPositions == null ||
      !Number.isFinite(maxPositions) ||
      maxPositions <= 0 ||
      maxSingleNotional == null ||
      !Number.isFinite(maxSingleNotional) ||
      maxSingleNotional <= 0
    ) {
      toast.error('请填写有效的风控参数（均需大于 0）')
      return
    }

    setSaving(true)
    try {
      await configApi.updateRiskParams({
        maxTotalLossPct,
        maxConsecutiveLosses,
        maxPositions,
        maxSingleNotional,
      })
      queryClient.invalidateQueries({ queryKey: ['riskParams'] })
      toast.success('风控参数已保存')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <div className="py-8 text-center text-fg-subtle text-sm">加载中...</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="最大总亏损 (%)"
          type="number"
          step="0.1"
          value={form.maxTotalLossPct ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            setForm({
              ...form,
              maxTotalLossPct: raw === '' ? undefined : Number(raw),
            })
          }}
          suffix="%"
        />
        <Input
          label="最大连续亏损次数"
          type="number"
          value={form.maxConsecutiveLosses ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            setForm({
              ...form,
              maxConsecutiveLosses: raw === '' ? undefined : parseInt(raw, 10),
            })
          }}
        />
        <Input
          label="最大持仓数（全局上限）"
          type="number"
          value={form.maxPositions ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            setForm({
              ...form,
              maxPositions: raw === '' ? undefined : parseInt(raw, 10),
            })
          }}
        />
        <Input
          label="单笔最大金额 (USDT)"
          type="number"
          step="0.01"
          value={form.maxSingleNotional ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            setForm({
              ...form,
              maxSingleNotional: raw === '' ? undefined : Number(raw),
            })
          }}
          suffix="USDT"
        />
      </div>
      <p className="text-xs text-fg-muted -mt-1">
        实际开仓上限 = min(策略「上限」, 此处全局最大持仓数)。两处都需 ≥ 目标值才生效。
      </p>

      {riskParams?.circuitBreakerTriggered && (
        <div className="flex items-center justify-between gap-2 p-3 bg-up/10 border border-up/30 rounded-md">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-up shrink-0" />
            <div className="text-xs text-up">
              <span className="font-medium">熔断已触发</span>
              <span className="ml-2">{riskParams.circuitBreakerReason}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await configApi.resetCircuitBreaker()
                queryClient.invalidateQueries({ queryKey: ['riskParams'] })
                toast.success('熔断已解除')
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            解除熔断
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-fg-muted">
        <div>
          当前连续亏损：<span className="text-fg font-medium">{riskParams?.consecutiveLosses ?? 0}</span> 次
        </div>
        <Button size="sm" onClick={handleSave} loading={saving}>
          保存风控参数
        </Button>
      </div>
    </div>
  )
}
