/**
 * 回测引擎类型定义
 */

import type { FeeConfig } from './fee-calculator';
import type { SlippageConfig } from './slippage-calculator';

/** 策略参数（与现有 Strategy 字段对齐） */
export interface BacktestStrategyParams {
  cycleInterval: string;
  quantity: number;
  quantityType: 'BY_QUANTITY' | 'BY_NOTIONAL';
  leverage: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxPositions: number;
}

export interface BacktestEngineInput {
  symbol: string;
  params: BacktestStrategyParams;
  fee: FeeConfig;
  slippage: SlippageConfig;
  /** 初始资金，用于净值曲线 */
  initialBalance: number;
  klines: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

/** 单笔模拟成交明细 */
export interface BacktestTradeDetail {
  cycleId: string;
  side: 'LONG' | 'SHORT';
  openTime: number;
  closeTime: number;
  /** 开仓假设价 */
  openAssumedPrice: number;
  /** 开仓滑点后成交价 */
  openFillPrice: number;
  /** 平仓假设价（TP/SL 触发价） */
  closeAssumedPrice: number;
  /** 平仓滑点后成交价 */
  closeFillPrice: number;
  quantity: number;
  /** 毛盈亏（未扣费、未计滑点成本，仅按成交价差） */
  grossPnl: number;
  openFee: number;
  closeFee: number;
  totalFee: number;
  openSlippageCost: number;
  closeSlippageCost: number;
  totalSlippageCost: number;
  /** 净盈亏 = grossPnl - totalFee（滑点已体现在成交价中） */
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'EOD';
  takeProfitPrice: number;
  stopLossPrice: number;
}

/** 净值曲线采样点 */
export interface EquityCurvePoint {
  /** K 线时间戳 */
  t: number;
  /** 账户净值 = initialBalance - fees + realizedGross + unrealized */
  equity: number;
  /** 已平仓累计净盈亏（不含未平仓盯市） */
  realizedNet: number;
  /** 截至该时刻已支付手续费 */
  fees: number;
  /** 未平仓盯市盈亏 */
  unrealized: number;
  /** 当前 OPEN 仓位数 */
  openCount: number;
}

/** 回测统计（扣费+滑点后） */
export interface BacktestStats {
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  profitFactor: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  avgWin: number;
  avgLoss: number;
  totalFee: number;
  totalSlippageCost: number;
  grossPnl: number;
}

export interface BacktestEngineOutput {
  stats: BacktestStats;
  trades: BacktestTradeDetail[];
  equityCurve: EquityCurvePoint[];
}
