import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CrosshairMode,
  SeriesMarker,
  Time,
} from 'lightweight-charts'
import type { Kline, Position } from '@/types'

export interface KlineChartProps {
  data: Kline[]
  positions?: Position[]
  height?: number
}

export function KlineChart({ data, positions = [], height = 400 }: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a3a3a3',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a3a3a', width: 1, style: 3 },
        horzLine: { color: '#3a3a3a', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#2a2a2a',
      },
      timeScale: {
        borderColor: '#2a2a2a',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const series = chart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    })

    chartRef.current = chart
    seriesRef.current = series

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [height])

  useEffect(() => {
    if (!seriesRef.current || !data.length) return
    seriesRef.current.setData(
      data.map((k) => ({
        time: k.time as never,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      })),
    )

    // 添加持仓标记
    const markers: SeriesMarker<Time>[] = positions
      .filter((p) => p.openedAt)
      .map((p) => {
        const t = Math.floor(new Date(p.openedAt).getTime() / 1000) as Time
        return {
          time: t,
          position: (p.side === 'LONG' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          color: p.side === 'LONG' ? '#ef4444' : '#22c55e',
          shape: (p.side === 'LONG' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          text: `${p.side === 'LONG' ? '多' : '空'} ${p.quantity}`,
        }
      })
      .sort((a, b) => (a.time as number) - (b.time as number))

    seriesRef.current.setMarkers(markers)

    chartRef.current?.timeScale().fitContent()
  }, [data, positions])

  return <div ref={containerRef} className="w-full" style={{ height }} />
}
