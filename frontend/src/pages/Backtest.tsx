/**
 * 回测页面
 * - 单次回测 / 网格搜索表单
 * - 手续费 & 滑点配置
 * - 样本内外验证对比
 * - 网格对比表与成交明细
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, AlertTriangle, Trash2, RefreshCw, LineChart } from 'lucide-react'
import { backtestApi } from '@/api/backtest'
import { BacktestEquityChart } from '@/components/trading/BacktestEquityChart'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Tabs } from '@/components/ui/Tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/stores/toast'
import { CYCLE_OPTIONS, DEFAULT_SYMBOLS } from '@/utils/constants'
import { formatCurrency, formatNumber, formatPct, formatTime, pnlColor } from '@/utils/format'
import type {
  BacktestJob,
  BacktestJobType,
  BacktestResult,
  BacktestSampleType,
  BacktestTradeDetail,
  CreateBacktestInput,
  CycleInterval,
  EquityCurvePoint,
  GridSortBy,
  QuantityType,
} from '@/types'

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

function nowIso(): string {
  const d = new Date()
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString().slice(0, 16)
}

function parseNumList(raw: string): number[] {
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败',
}

const SAMPLE_LABEL: Record<BacktestSampleType, string> = {
  FULL: '全区间',
  IN_SAMPLE: '样本内',
  OUT_OF_SAMPLE: '样本外',
}

export function Backtest() {
  const queryClient = useQueryClient()
  const [jobType, setJobType] = useState<BacktestJobType>('SINGLE')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ---- 表单状态 ----
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [startTime, setStartTime] = useState(daysAgoIso(7))
  const [endTime, setEndTime] = useState(nowIso())
  const [cycleInterval, setCycleInterval] = useState<CycleInterval>('5m')
  const [quantity, setQuantity] = useState('0.001')
  const [quantityType, setQuantityType] = useState<QuantityType>('BY_QUANTITY')
  const [leverage, setLeverage] = useState('10')
  const [takeProfitPct, setTakeProfitPct] = useState('1.5')
  const [stopLossPct, setStopLossPct] = useState('1.0')
  const [maxPositions, setMaxPositions] = useState('10')
  const [initialBalance, setInitialBalance] = useState('10000')

  const [feeEnabled, setFeeEnabled] = useState(true)
  const [openFeeRate, setOpenFeeRate] = useState('0.0004')
  const [closeFeeRate, setCloseFeeRate] = useState('0.0004')
  const [slipEnabled, setSlipEnabled] = useState(true)
  const [slipPct, setSlipPct] = useState('0.0002')

  const [oosEnabled, setOosEnabled] = useState(false)
  const [oosRatio, setOosRatio] = useState('0.7')

  // 网格候选（逗号分隔）
  const [gridTp, setGridTp] = useState('1.0,1.5')
  const [gridSl, setGridSl] = useState('0.8,1.2')
  const [gridLev, setGridLev] = useState('')
  const [gridQty, setGridQty] = useState('')
  const [sortBy, setSortBy] = useState<GridSortBy>('totalPnl')
  const [topN, setTopN] = useState('5')

  const { data: meta } = useQuery({
    queryKey: ['backtest-meta'],
    queryFn: backtestApi.meta,
  })

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['backtests'],
    queryFn: () => backtestApi.list(30),
    refetchInterval: (query) => {
      const list = query.state.data as BacktestJob[] | undefined
      const busy = list?.some((j) => j.status === 'PENDING' || j.status === 'RUNNING')
      return busy ? 2000 : false
    },
  })

  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['backtest', selectedId],
    queryFn: () => backtestApi.get(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (query) => {
      const job = query.state.data as BacktestJob | undefined
      return job?.status === 'PENDING' || job?.status === 'RUNNING' ? 2000 : false
    },
  })

  useEffect(() => {
    if (meta) {
      setOpenFeeRate(String(meta.defaults.openFeeRate))
      setCloseFeeRate(String(meta.defaults.closeFeeRate))
      setSlipPct(String(meta.defaults.slippagePct))
      if (meta.defaults.initialBalance != null) {
        setInitialBalance(String(meta.defaults.initialBalance))
      }
    }
  }, [meta])

  const createMutation = useMutation({
    mutationFn: backtestApi.create,
    onSuccess: (job) => {
      toast.success('回测任务已创建')
      queryClient.invalidateQueries({ queryKey: ['backtests'] })
      setSelectedId(job.id)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteMutation = useMutation({
    mutationFn: backtestApi.remove,
    onSuccess: () => {
      toast.success('已删除')
      if (selectedId) setSelectedId(null)
      queryClient.invalidateQueries({ queryKey: ['backtests'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const buildInput = (): CreateBacktestInput => {
    const input: CreateBacktestInput = {
      type: jobType,
      symbol,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      initialBalance: Number(initialBalance),
      params: {
        cycleInterval,
        quantity: Number(quantity),
        quantityType,
        leverage: Number(leverage),
        takeProfitPct: Number(takeProfitPct),
        stopLossPct: Number(stopLossPct),
        maxPositions: Number(maxPositions),
      },
      fee: {
        enabled: feeEnabled,
        openFeeRate: Number(openFeeRate),
        closeFeeRate: Number(closeFeeRate),
      },
      slippage: {
        enabled: slipEnabled,
        pct: Number(slipPct),
      },
      sampleSplit: {
        enabled: oosEnabled,
        mode: 'ratio',
        inSampleRatio: Number(oosRatio),
      },
    }

    if (jobType === 'GRID') {
      input.grid = {
        takeProfitPct: parseNumList(gridTp),
        stopLossPct: parseNumList(gridSl),
      }
      const lev = parseNumList(gridLev)
      const qty = parseNumList(gridQty)
      if (lev.length) input.grid.leverage = lev.map((n) => Math.round(n))
      if (qty.length) input.grid.quantity = qty
      input.sortBy = sortBy
      input.topN = Number(topN)
    }

    return input
  }

  const handleSubmit = () => {
    try {
      createMutation.mutate(buildInput())
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const results = detail?.results || []
  const isResults = results.filter((r) => r.sampleType === 'IN_SAMPLE')
  const oosResults = results.filter((r) => r.sampleType === 'OUT_OF_SAMPLE')
  const fullResults = results.filter((r) => r.sampleType === 'FULL')

  const primaryTrades = useMemo(() => {
    const pick = (list: BacktestResult[]) =>
      list.find((r) => Array.isArray(r.trades) && r.trades.length > 0)
    const withTrades = pick(oosResults) || pick(fullResults) || pick(isResults)
    return (withTrades?.trades as BacktestTradeDetail[] | null) || []
  }, [fullResults, isResults, oosResults])

  const primaryCurve = useMemo(() => {
    const pick = (list: BacktestResult[]) =>
      list.find((r) => Array.isArray(r.curve) && r.curve.length > 0)
    const withCurve = pick(oosResults) || pick(fullResults) || pick(isResults)
    return (withCurve?.curve as EquityCurvePoint[] | null) || null
  }, [fullResults, isResults, oosResults])

  const showOverfitWarn =
    detail?.status === 'COMPLETED' &&
    detail.type === 'GRID' &&
    !(detail.config?.sampleSplit?.enabled)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-fg">策略回测</h1>
          <p className="text-xs text-fg-muted mt-0.5">
            历史 K 线验证周期对冲策略 · 含手续费 / 滑点 / 网格 / 样本外验证（不下单）
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['backtests'] })}
        >
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 左侧：配置 */}
        <div className="xl:col-span-1 space-y-3">
          <Card title="新建回测">
            <Tabs
              items={[
                { key: 'SINGLE', label: '单次回测' },
                { key: 'GRID', label: '网格搜索' },
              ]}
              value={jobType}
              onChange={(k) => setJobType(k as BacktestJobType)}
            />

            <div className="mt-4 space-y-3">
              <Select
                label="交易对"
                options={DEFAULT_SYMBOLS.map((s) => ({ label: s, value: s }))}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="开始时间 (UTC)"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <Input
                  label="结束时间 (UTC)"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>

              <Select
                label="周期"
                options={CYCLE_OPTIONS}
                value={cycleInterval}
                onChange={(e) => setCycleInterval(e.target.value as CycleInterval)}
              />

              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="数量"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <Select
                  label="数量类型"
                  options={[
                    { label: '按数量', value: 'BY_QUANTITY' },
                    { label: '按名义金额', value: 'BY_NOTIONAL' },
                  ]}
                  value={quantityType}
                  onChange={(e) => setQuantityType(e.target.value as QuantityType)}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Input label="杠杆" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
                <Input
                  label="止盈 %"
                  value={takeProfitPct}
                  onChange={(e) => setTakeProfitPct(e.target.value)}
                />
                <Input
                  label="止损 %"
                  value={stopLossPct}
                  onChange={(e) => setStopLossPct(e.target.value)}
                />
              </div>
              <Input
                label="最大持仓数"
                value={maxPositions}
                onChange={(e) => setMaxPositions(e.target.value)}
              />
              <Input
                label="初始金额 (USDT)"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
              />
              {meta?.defaults.equityNote && (
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  {meta.defaults.equityNote}
                </p>
              )}

              {jobType === 'GRID' && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="text-xs font-medium text-fg">网格候选（逗号分隔）</div>
                  <Input
                    label="止盈 % 列表"
                    value={gridTp}
                    onChange={(e) => setGridTp(e.target.value)}
                    placeholder="1.0,1.5,2.0"
                  />
                  <Input
                    label="止损 % 列表"
                    value={gridSl}
                    onChange={(e) => setGridSl(e.target.value)}
                    placeholder="0.8,1.0,1.2"
                  />
                  <Input
                    label="杠杆列表（可选）"
                    value={gridLev}
                    onChange={(e) => setGridLev(e.target.value)}
                    placeholder="5,10"
                  />
                  <Input
                    label="数量列表（可选）"
                    value={gridQty}
                    onChange={(e) => setGridQty(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      label="排序目标"
                      options={[
                        { label: '总盈亏', value: 'totalPnl' },
                        { label: '胜率', value: 'winRate' },
                        { label: '最大回撤', value: 'maxDrawdown' },
                        { label: '盈亏比', value: 'profitFactor' },
                        { label: '交易次数', value: 'totalTrades' },
                      ]}
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as GridSortBy)}
                    />
                    <Input label="Top N" value={topN} onChange={(e) => setTopN(e.target.value)} />
                  </div>
                  {meta && (
                    <p className="text-[11px] text-fg-subtle">
                      组合上限 {meta.limits.maxGridCombinations}
                    </p>
                  )}
                </div>
              )}

              {/* 手续费 */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">计入手续费</span>
                <Switch checked={feeEnabled} onChange={setFeeEnabled} size="sm" />
              </div>
              {feeEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="开仓费率"
                    value={openFeeRate}
                    onChange={(e) => setOpenFeeRate(e.target.value)}
                  />
                  <Input
                    label="平仓费率"
                    value={closeFeeRate}
                    onChange={(e) => setCloseFeeRate(e.target.value)}
                  />
                </div>
              )}

              {/* 滑点 */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">计入滑点</span>
                <Switch checked={slipEnabled} onChange={setSlipEnabled} size="sm" />
              </div>
              {slipEnabled && (
                <Input
                  label="滑点比例"
                  value={slipPct}
                  onChange={(e) => setSlipPct(e.target.value)}
                  suffix="pct"
                />
              )}
              {meta && (
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  {meta.defaults.feeNote}；{meta.defaults.slippageNote}
                </p>
              )}

              {/* 样本外 */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">样本外验证</span>
                <Switch checked={oosEnabled} onChange={setOosEnabled} size="sm" />
              </div>
              {oosEnabled ? (
                <Input
                  label="样本内占比"
                  value={oosRatio}
                  onChange={(e) => setOosRatio(e.target.value)}
                  placeholder="0.7"
                />
              ) : (
                <div className="flex items-start gap-2 rounded-md bg-warn/10 border border-warn/30 p-2 text-[11px] text-warn">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    未启用样本外验证时，网格最优结果可能过拟合，请勿直接作为实盘结论。
                  </span>
                </div>
              )}

              <Button
                className="w-full"
                loading={createMutation.isPending}
                onClick={handleSubmit}
              >
                <FlaskConical size={16} />
                开始回测
              </Button>
            </div>
          </Card>

          <Card title="任务列表">
            {jobsLoading && <div className="text-xs text-fg-muted">加载中…</div>}
            {!jobsLoading && (!jobs || jobs.length === 0) && (
              <EmptyState title="暂无回测任务" description="配置参数后点击开始回测" />
            )}
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {jobs?.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedId === job.id
                      ? 'bg-brand/10 text-brand'
                      : 'hover:bg-bg-hover text-fg'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs truncate">
                      {job.symbol} · {job.type === 'GRID' ? '网格' : '单次'}
                    </span>
                    <Badge
                      variant={
                        job.status === 'COMPLETED'
                          ? 'success'
                          : job.status === 'FAILED'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {STATUS_LABEL[job.status] || job.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-fg-subtle mt-0.5">
                    {formatTime(job.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* 右侧：结果 */}
        <div className="xl:col-span-2 space-y-3">
          {!selectedId && (
            <Card>
              <EmptyState
                title="选择或创建一个回测任务"
                description="结果将展示扣费+滑点后的统计、网格对比与样本内外指标"
              />
            </Card>
          )}

          {selectedId && detail && (
            <>
              <Card
                title={`${detail.symbol} · ${detail.type === 'GRID' ? '网格搜索' : '单次回测'}`}
                extra={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(detail.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                }
              >
                <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
                  <span>状态：{STATUS_LABEL[detail.status]}</span>
                  <span>
                    区间：{formatTime(detail.startTime)} → {formatTime(detail.endTime)}
                  </span>
                  {detail.error && <span className="text-up">错误：{detail.error}</span>}
                  {detailLoading && <span>刷新中…</span>}
                </div>

                {showOverfitWarn && (
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-warn/10 border border-warn/30 p-2 text-xs text-warn">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    本任务未启用样本外验证，网格排序仅反映样本内表现，存在过拟合风险。
                  </div>
                )}
              </Card>

              {/* 样本内外对比 */}
              {(isResults.length > 0 || oosResults.length > 0) && (
                <Card title="样本内 vs 样本外">
                  <SampleCompareTable isResults={isResults} oosResults={oosResults} />
                </Card>
              )}

              {/* 网格 / 全区间对比表 */}
              {(fullResults.length > 0 || isResults.length > 1) && (
                <Card title="参数对比表（扣费+滑点后）">
                  <GridTable results={fullResults.length ? fullResults : isResults} />
                </Card>
              )}

              {/* 单次 / Top1 统计卡片 */}
              {(() => {
                const top =
                  oosResults.find((r) => r.rank === 1) ||
                  fullResults.find((r) => r.rank === 1) ||
                  isResults.find((r) => r.rank === 1) ||
                  results[0]
                if (!top) return null
                return (
                  <Card
                    title={`核心指标 · ${SAMPLE_LABEL[top.sampleType]}${
                      top.rank ? ` · #${top.rank}` : ''
                    }`}
                  >
                    <StatsGrid stats={top.stats} />
                    <div className="mt-3 text-xs text-fg-muted font-mono">
                      参数：周期 {top.params.cycleInterval} / TP {top.params.takeProfitPct}% / SL{' '}
                      {top.params.stopLossPct}% / 杠杆 {top.params.leverage}x / 数量{' '}
                      {top.params.quantity}
                    </div>
                  </Card>
                )
              })()}

              {/* 净值曲线（含盯市） */}
              {(primaryCurve?.length || primaryTrades.length > 0) && (
                <Card
                  title="净值曲线"
                  extra={<LineChart size={14} className="text-fg-muted" />}
                >
                  <BacktestEquityChart
                    curve={primaryCurve}
                    trades={primaryTrades}
                    height={320}
                  />
                </Card>
              )}

              {/* 成交明细 */}
              {primaryTrades.length > 0 && (
                <Card title={`成交明细（${primaryTrades.length} 笔）`}>
                  <TradesTable trades={primaryTrades} />
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatsGrid({ stats }: { stats: BacktestResult['stats'] }) {
  const items = [
    { label: '净盈亏', value: formatCurrency(stats.totalPnl), color: pnlColor(stats.totalPnl) },
    { label: '胜率', value: formatPct(stats.winRate) },
    { label: '最大回撤', value: formatCurrency(stats.maxDrawdown) },
    { label: '盈亏比', value: formatNumber(stats.profitFactor) },
    { label: '交易次数', value: String(stats.totalTrades) },
    { label: '总手续费', value: formatCurrency(stats.totalFee) },
    { label: '总滑点成本', value: formatCurrency(stats.totalSlippageCost) },
    { label: '毛盈亏', value: formatCurrency(stats.grossPnl), color: pnlColor(stats.grossPnl) },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-md bg-bg-elevated px-3 py-2">
          <div className="text-[11px] text-fg-muted">{it.label}</div>
          <div className={`text-sm font-mono mt-1 ${it.color || 'text-fg'}`}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}

function GridTable({ results }: { results: BacktestResult[] }) {
  const sorted = [...results].sort((a, b) => (a.rank || 999) - (b.rank || 999))
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>排名</TableHead>
            <TableHead>周期</TableHead>
            <TableHead>TP%</TableHead>
            <TableHead>SL%</TableHead>
            <TableHead>杠杆</TableHead>
            <TableHead>数量</TableHead>
            <TableHead>净盈亏</TableHead>
            <TableHead>胜率</TableHead>
            <TableHead>回撤</TableHead>
            <TableHead>盈亏比</TableHead>
            <TableHead>笔数</TableHead>
            <TableHead>手续费</TableHead>
            <TableHead>滑点</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.id} className={r.isTop ? 'bg-brand/5' : undefined}>
              <TableCell>{r.rank}</TableCell>
              <TableCell>{r.params.cycleInterval}</TableCell>
              <TableCell>{r.params.takeProfitPct}</TableCell>
              <TableCell>{r.params.stopLossPct}</TableCell>
              <TableCell>{r.params.leverage}</TableCell>
              <TableCell>{r.params.quantity}</TableCell>
              <TableCell className={pnlColor(r.stats.totalPnl)}>
                {formatCurrency(r.stats.totalPnl)}
              </TableCell>
              <TableCell>{formatPct(r.stats.winRate)}</TableCell>
              <TableCell>{formatCurrency(r.stats.maxDrawdown)}</TableCell>
              <TableCell>{formatNumber(r.stats.profitFactor)}</TableCell>
              <TableCell>{r.stats.totalTrades}</TableCell>
              <TableCell>{formatCurrency(r.stats.totalFee)}</TableCell>
              <TableCell>{formatCurrency(r.stats.totalSlippageCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SampleCompareTable({
  isResults,
  oosResults,
}: {
  isResults: BacktestResult[]
  oosResults: BacktestResult[]
}) {
  const rows = isResults.filter((r) => r.isTop).slice(0, 5)
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>参数</TableHead>
            <TableHead>样本内盈亏</TableHead>
            <TableHead>样本内胜率</TableHead>
            <TableHead>样本外盈亏</TableHead>
            <TableHead>样本外胜率</TableHead>
            <TableHead>样本外回撤</TableHead>
            <TableHead>样本外笔数</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((is) => {
            const oos =
              oosResults.find(
                (o) =>
                  o.params.takeProfitPct === is.params.takeProfitPct &&
                  o.params.stopLossPct === is.params.stopLossPct &&
                  o.params.leverage === is.params.leverage &&
                  o.params.quantity === is.params.quantity &&
                  o.params.cycleInterval === is.params.cycleInterval,
              ) || oosResults.find((o) => o.rank === is.rank)
            return (
              <TableRow key={is.id}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  TP{is.params.takeProfitPct}/SL{is.params.stopLossPct} {is.params.cycleInterval}
                </TableCell>
                <TableCell className={pnlColor(is.stats.totalPnl)}>
                  {formatCurrency(is.stats.totalPnl)}
                </TableCell>
                <TableCell>{formatPct(is.stats.winRate)}</TableCell>
                <TableCell className={pnlColor(oos?.stats.totalPnl)}>
                  {oos ? formatCurrency(oos.stats.totalPnl) : '--'}
                </TableCell>
                <TableCell>{oos ? formatPct(oos.stats.winRate) : '--'}</TableCell>
                <TableCell>{oos ? formatCurrency(oos.stats.maxDrawdown) : '--'}</TableCell>
                <TableCell>{oos?.stats.totalTrades ?? '--'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function TradesTable({ trades }: { trades: NonNullable<BacktestResult['trades']> }) {
  const shown = trades.slice(0, 100)
  return (
    <div className="overflow-x-auto max-h-96">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>方向</TableHead>
            <TableHead>开仓价→成交</TableHead>
            <TableHead>平仓价→成交</TableHead>
            <TableHead>数量</TableHead>
            <TableHead>净盈亏</TableHead>
            <TableHead>手续费</TableHead>
            <TableHead>滑点成本</TableHead>
            <TableHead>原因</TableHead>
            <TableHead>平仓时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((t, i) => (
            <TableRow key={`${t.cycleId}-${t.side}-${i}`}>
              <TableCell>{t.side}</TableCell>
              <TableCell className="font-mono text-xs">
                {formatNumber(t.openAssumedPrice, 2)} → {formatNumber(t.openFillPrice, 2)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatNumber(t.closeAssumedPrice, 2)} → {formatNumber(t.closeFillPrice, 2)}
              </TableCell>
              <TableCell>{t.quantity}</TableCell>
              <TableCell className={pnlColor(t.netPnl)}>{formatCurrency(t.netPnl)}</TableCell>
              <TableCell>{formatCurrency(t.totalFee)}</TableCell>
              <TableCell>{formatCurrency(t.totalSlippageCost)}</TableCell>
              <TableCell>{t.exitReason}</TableCell>
              <TableCell className="text-xs">{formatTime(t.closeTime)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {trades.length > 100 && (
        <p className="text-[11px] text-fg-subtle mt-2">仅展示前 100 笔，共 {trades.length} 笔</p>
      )}
    </div>
  )
}
