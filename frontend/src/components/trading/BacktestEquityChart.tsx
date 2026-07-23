/**
 * 回测净值曲线
 * 主线：账户净值（初始金额 − 手续费 + 已实现毛盈亏 + 未平仓盯市）
 * 副线：累计净盈亏（仅已平仓，不含盯市）
 */

import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts'
import type { BacktestTradeDetail, EquityCurvePoint } from '@/types'
import { formatTimeShort } from '@/utils/format'

export interface BacktestEquityChartProps {
  /** 后端引擎采样的净值曲线（含盯市） */
  curve?: EquityCurvePoint[] | null
  /** 旧任务兜底：仅用成交累计净盈亏（无盯市） */
  trades?: BacktestTradeDetail[]
  height?: number
}

interface ChartPoint {
  time: string
  equity: number
  realizedNet: number
}

function fromCurve(curve: EquityCurvePoint[]): ChartPoint[] {
  return curve.map((p) => ({
    time: formatTimeShort(p.t),
    equity: Number(p.equity) || 0,
    realizedNet: Number(p.realizedNet) || 0,
  }))
}

/** 旧结果无 curve 时：用成交净盈亏累加作副线，主线不可用则只画 realizedNet */
function fromTradesFallback(trades: BacktestTradeDetail[]): ChartPoint[] {
  if (!trades?.length) return []
  const sorted = [...trades].sort(
    (a, b) => a.closeTime - b.closeTime || a.openTime - b.openTime,
  )
  let realizedNet = 0
  return sorted.map((t) => {
    realizedNet += Number(t.netPnl) || 0
    const v = Math.round(realizedNet * 1e6) / 1e6
    return {
      time: formatTimeShort(t.closeTime),
      equity: v,
      realizedNet: v,
    }
  })
}

export function BacktestEquityChart({
  curve,
  trades = [],
  height = 320,
}: BacktestEquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const { data, hasEngineCurve } = useMemo(() => {
    if (Array.isArray(curve) && curve.length > 0) {
      return { data: fromCurve(curve), hasEngineCurve: true }
    }
    return { data: fromTradesFallback(trades), hasEngineCurve: false }
  }, [curve, trades])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart

    const handleResize = () => chart.resize()
    window.addEventListener('resize', handleResize)
    const raf = requestAnimationFrame(() => chart.resize())

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', handleResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || data.length === 0) return

    const times = data.map((d) => d.time)
    const equity = data.map((d) => d.equity)
    const realizedNet = data.map((d) => d.realizedNet)

    chart.setOption(
      {
        backgroundColor: 'transparent',
        legend: {
          data: hasEngineCurve ? ['账户净值', '累计净盈亏'] : ['累计净盈亏'],
          top: 0,
          textStyle: { color: '#a3a3a3', fontSize: 11 },
        },
        grid: {
          left: 56,
          right: 20,
          top: 36,
          bottom: times.length > 24 ? 48 : 36,
        },
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#1a1a1a',
          borderColor: '#2a2a2a',
          textStyle: { color: '#f5f5f5', fontSize: 12 },
          formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
            const time = params[0]?.axisValue
            let html = `<div style="font-weight:500;margin-bottom:4px">${time}</div>`
            params.forEach((p) => {
              html += `<div style="color:${p.color}">${p.seriesName}: ${p.value >= 0 ? '+' : ''}${p.value.toFixed(4)}</div>`
            })
            return html
          },
        },
        xAxis: {
          type: 'category',
          data: times,
          axisLine: { lineStyle: { color: '#2a2a2a' } },
          axisLabel: {
            color: '#a3a3a3',
            fontSize: 10,
            hideOverlap: true,
            rotate: times.length > 24 ? 35 : 0,
          },
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLine: { show: false },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
          axisLabel: { color: '#a3a3a3', fontSize: 11 },
        },
        series: hasEngineCurve
          ? [
              {
                name: '账户净值',
                type: 'line',
                data: equity,
                smooth: true,
                symbol: data.length > 80 ? 'none' : 'circle',
                symbolSize: 3,
                lineStyle: { color: '#3b82f6', width: 2 },
                itemStyle: { color: '#3b82f6' },
                areaStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(59,130,246,0.25)' },
                    { offset: 1, color: 'rgba(59,130,246,0)' },
                  ]),
                },
              },
              {
                name: '累计净盈亏',
                type: 'line',
                data: realizedNet,
                smooth: true,
                symbol: 'none',
                lineStyle: { color: '#a78bfa', width: 1.5, type: 'dashed' },
                itemStyle: { color: '#a78bfa' },
              },
            ]
          : [
              {
                name: '累计净盈亏',
                type: 'line',
                data: realizedNet,
                smooth: true,
                symbol: data.length > 80 ? 'none' : 'circle',
                symbolSize: 3,
                lineStyle: { color: '#3b82f6', width: 2 },
                itemStyle: { color: '#3b82f6' },
              },
            ],
      },
      { notMerge: true },
    )
    chart.resize()
  }, [data, hasEngineCurve])

  if (data.length === 0) return null

  return (
    <div className="space-y-2">
      {!hasEngineCurve && (
        <p className="text-[11px] text-warn">
          当前任务无盯市净值曲线（旧结果），仅展示成交累计净盈亏。请用新配置重跑以查看完整净值。
        </p>
      )}
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  )
}
