import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { DailyPnl } from '@/types'

export interface PnlChartProps {
  data: DailyPnl[]
  height?: number
}

export function PnlChart({ data, height = 300 }: PnlChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = echarts.init(containerRef.current, 'dark', {
      renderer: 'canvas',
    })
    chartRef.current = chart

    const handleResize = () => chart.resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current) return

    const dates = data.map((d) => d.date)
    const pnls = data.map((d) => d.pnl)
    const cumulative = data.map((d) => d.cumulative)

    chartRef.current.setOption({
      backgroundColor: 'transparent',
      grid: { left: 50, right: 50, top: 20, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1a1a',
        borderColor: '#2a2a2a',
        textStyle: { color: '#f5f5f5', fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number }[]) => {
          const date = params[0]?.axisValue
          let html = `<div style="font-weight:500;margin-bottom:4px">${date}</div>`
          params.forEach((p) => {
            const color = p.value >= 0 ? '#ef4444' : '#22c55e'
            html += `<div style="color:${color}">${p.seriesName}: ${p.value >= 0 ? '+' : ''}${p.value.toFixed(2)}</div>`
          })
          return html
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisLabel: { color: '#a3a3a3', fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          name: '日盈亏',
          position: 'left',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
          axisLabel: { color: '#a3a3a3', fontSize: 11 },
        },
        {
          type: 'value',
          name: '累计',
          position: 'right',
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#a3a3a3', fontSize: 11 },
        },
      ],
      series: [
        {
          name: '日盈亏',
          type: 'bar',
          data: pnls.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#ef4444' : '#22c55e' },
          })),
          barWidth: '60%',
        },
        {
          name: '累计盈亏',
          type: 'line',
          yAxisIndex: 1,
          data: cumulative,
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { color: '#3b82f6', width: 2 },
          itemStyle: { color: '#3b82f6' },
        },
      ],
    })
  }, [data])

  return <div ref={containerRef} className="w-full" style={{ height }} />
}
