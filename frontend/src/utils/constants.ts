import type { CycleInterval, StrategyStatus, PositionStatus, Side, Environment } from '@/types'

export const CYCLE_OPTIONS: { label: string; value: CycleInterval }[] = [
  { label: '1 分钟', value: '1m' },
  { label: '3 分钟', value: '3m' },
  { label: '5 分钟', value: '5m' },
  { label: '15 分钟', value: '15m' },
  { label: '1 小时', value: '1h' },
  { label: '4 小时', value: '4h' },
  { label: '1 天', value: '1d' },
]

export const DEFAULT_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
]

export const EXCHANGES = [
  { label: 'Binance 币安', value: 'BINANCE' },
  { label: 'Lighter', value: 'LIGHTER' },
  { label: 'OKX 欧易', value: 'OKX' },
  { label: 'Bybit', value: 'BYBIT' },
  { label: 'Gate.io', value: 'GATE' },
]

export const STATUS_LABEL: Record<StrategyStatus, string> = {
  IDLE: '空闲',
  RUNNING: '运行中',
  ARMED: '运行中',
  OPENING: '开仓中',
  MONITORING: '运行中',
  CLOSING: '平仓中',
  DONE: '已完成',
  ERROR: '异常',
  PAUSED: '已暂停',
  STOPPED: '已停止',
}

export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  OPEN: '持仓中',
  TP_HIT: '止盈',
  SL_HIT: '止损',
  CLOSED: '已平仓',
  MANUAL: '手动平仓',
}

export const SIDE_LABEL: Record<Side, string> = {
  LONG: '多',
  SHORT: '空',
}

export const ENV_LABEL: Record<Environment, string> = {
  TESTNET: '模拟盘',
  LIVE: '实盘',
}

export const STATUS_VARIANT: Record<
  StrategyStatus,
  'neutral' | 'success' | 'warn' | 'danger'
> = {
  IDLE: 'neutral',
  RUNNING: 'success',
  ARMED: 'success',
  OPENING: 'success',
  MONITORING: 'success',
  CLOSING: 'warn',
  DONE: 'neutral',
  ERROR: 'danger',
  PAUSED: 'warn',
  STOPPED: 'danger',
}

export const POSITION_STATUS_VARIANT: Record<
  PositionStatus,
  'info' | 'success' | 'danger' | 'neutral' | 'warn'
> = {
  OPEN: 'info',
  TP_HIT: 'success',
  SL_HIT: 'danger',
  CLOSED: 'neutral',
  MANUAL: 'warn',
}
