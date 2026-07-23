/**
 * 回测模块常量与默认值
 * 手续费默认按币安 U 本位合约 Taker；滑点默认按名义金额百分比（bps）
 */

/** 单次回测允许的最大 K 线根数 */
export const MAX_KLINES = 10_000;

/** 回测最大时间跨度（天） */
export const MAX_BACKTEST_DAYS = 365;

/** 网格搜索最大组合数 */
export const MAX_GRID_COMBINATIONS = 200;

/** 网格结果默认 Top N */
export const DEFAULT_GRID_TOP_N = 10;

/**
 * 默认开仓/平仓费率（Taker 0.04% = 4 bps）
 * 关闭手续费时传 enabled=false，可与「理想成交」对比
 */
export const DEFAULT_OPEN_FEE_RATE = 0.0004;
export const DEFAULT_CLOSE_FEE_RATE = 0.0004;

/**
 * 默认滑点：名义金额的 0.02%（2 bps）
 * 关闭滑点时传 enabled=false
 */
export const DEFAULT_SLIPPAGE_PCT = 0.0002;

/** 回测默认初始资金（USDT） */
export const DEFAULT_INITIAL_BALANCE = 10_000;

/** 净值曲线最大采样点数（均匀降采样，保证可复现） */
export const MAX_EQUITY_CURVE_POINTS = 2_000;

/** 周期间隔对应的毫秒数 */
export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export enum BacktestJobType {
  SINGLE = 'SINGLE',
  GRID = 'GRID',
}

export enum BacktestJobStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum BacktestSampleType {
  FULL = 'FULL',
  IN_SAMPLE = 'IN_SAMPLE',
  OUT_OF_SAMPLE = 'OUT_OF_SAMPLE',
}

export type GridSortBy =
  | 'totalPnl'
  | 'winRate'
  | 'maxDrawdown'
  | 'profitFactor'
  | 'totalTrades';
