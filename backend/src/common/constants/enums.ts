/**
 * 共享枚举与类型定义
 */

export enum Environment {
  TESTNET = 'TESTNET',
  LIVE = 'LIVE',
}

export enum ExchangeName {
  BINANCE = 'BINANCE',
  LIGHTER = 'LIGHTER',
}

export enum CycleInterval {
  M1 = '1m',
  M3 = '3m',
  M5 = '5m',
  M15 = '15m',
  H1 = '1h',
  H4 = '4h',
  D1 = '1d',
}

export enum QuantityType {
  BY_QUANTITY = 'BY_QUANTITY',
  BY_NOTIONAL = 'BY_NOTIONAL',
}

export enum MarginMode {
  ISOLATED = 'ISOLATED',
  CROSSED = 'CROSSED',
}

export enum StrategyStatus {
  IDLE = 'IDLE',
  /** 前端「运行中」状态；与 ARMED 等价，用于 UI 兼容 */
  RUNNING = 'RUNNING',
  ARMED = 'ARMED',
  OPENING = 'OPENING',
  MONITORING = 'MONITORING',
  CLOSING = 'CLOSING',
  DONE = 'DONE',
  ERROR = 'ERROR',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum PositionStatus {
  OPEN = 'OPEN',
  TP_HIT = 'TP_HIT',
  SL_HIT = 'SL_HIT',
  CLOSED = 'CLOSED',
  MANUAL = 'MANUAL',
}

export enum OrderType {
  MARKET = 'MARKET',
  STOP_MARKET = 'STOP_MARKET',
  TAKE_PROFIT_MARKET = 'TAKE_PROFIT_MARKET',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  REJECTED = 'REJECTED',
}

export const CYCLE_INTERVALS = Object.values(CycleInterval);
