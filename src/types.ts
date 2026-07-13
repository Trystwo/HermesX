/** 行情模块通用接口 */
import { EventEmitter } from 'events';

export interface IMarket extends EventEmitter {
  readonly currentPrice: number;
  readonly lastHourCandle: Candle | null;
  start(): void;
  destroy(): void;
}

/** 做多/做空方向 */
export type PositionSide = 'long' | 'short';

/** 虚拟仓位 */
export interface Position {
  side: PositionSide;
  /** 持仓数量（币的数量，不是美元） */
  quantity: number;
  /** 开仓均价 */
  averageEntryPrice: number;
  /** 最近一次加仓/开仓价格（用作止损参考） */
  latestEntryPrice: number;
}

/** 账户快照，用于状态推送 */
export interface AccountSnapshot {
  name: string;
  side: PositionSide;
  balance: number;
  equity: number;            // 余额 + 浮动盈亏
  position: Position | null;
  unrealizedPnL: number;
  lossPercent: number;       // 从最新加仓价算的亏损%
  isStopped: boolean;        // 是否刚被止损
}

/** 模拟全局状态快照 */
export interface SimSnapshot {
  timestamp: number;
  /** 引擎启动时间戳（毫秒） */
  startTime: number;
  currentPrice: number;
  accounts: [AccountSnapshot, AccountSnapshot];
  totalEquity: number;
  hourlyProfit: number;      // 上小时总盈利
  elapsedHours: number;
  logEntries: string[];
}

/** K 线数据 */
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Binance WS 事件 */
export interface BinanceKlineMsg {
  e: 'kline';
  k: {
    t: number;   // 开盘时间
    o: string;   // 开盘价
    h: string;   // 最高
    l: string;   // 最低
    c: string;   // 收盘价
    x: boolean;  // K线是否完结
  };
}

export interface BinanceBookTickerMsg {
  e: 'bookTicker';
  u: number;
  s: string;     // 交易对
  b: string;     // 买价
  a: string;     // 卖价
}

// ========== v2 多空双开回测类型 ==========

/** 独立小仓位（lot） */
export interface Lot {
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;   // 币数量
  margin: number;     // 占用保证金
  slPrice: number;    // 止损价
  tpPrice: number;    // 止盈价
}

/** 回测快照（v2） */
export interface V2BacktestSnapshot {
  hour: number;
  timestamp: number;
  openPrice: number;
  equity: number;
  balance: number;
  unrealizedPnL: number;
  longPnL: number;
  shortPnL: number;
  totalReturnPct: number;
  longLots: Lot[];
  shortLots: Lot[];
  /** 本步被平掉的 lots（止损或止盈） */
  stoppedLots: { side: string; entryPrice: number; closePrice: number; pnl: number; fee: number; reason: 'sl' | 'tp' }[];
  action: string;
}

/** 回测参数（v2） */
export interface V2BacktestParams {
  symbol: string;
  days: number;
  interval: string;          // Binance K线周期: 1h, 2h, 4h, 6h, 12h, 1d
  leverage: number;
  marginRatio: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  positionAmountValue: number;
  initialBalance: number;    // 初始资金
  direction: 'both' | 'long' | 'short';  // 方向：双开/只多/只空
}

/** 开单记录（含最终状态） */
export interface AllLotRecord {
  side: 'long' | 'short';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  quantity: number;
  margin: number;
  openTime: number;         // 开单时的 K 线时间戳
  status: 'open' | 'stopped';
  closePrice?: number;
  reason?: 'sl' | 'tp';
  pnl?: number;
  fee?: number;
}

/** 回测运行时状态（v2）— 可在服务端和客户端间 JSON 序列化 */
export interface V2BacktestState {
  symbol: string;
  initialBalance: number;
  params: {
    interval: string;
    leverage: number;
    marginRatio: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    positionAmountValue: number;
    direction: 'both' | 'long' | 'short';
  };
  candles: Candle[];
  currentIndex: number;
  balance: number;
  longLots: Lot[];
  shortLots: Lot[];
  snapshots: V2BacktestSnapshot[];
  totalFee: number;         // 累计手续费
  totalOpenCount: number;   // 累计开单数（每对多+空算1次）
  allLots: AllLotRecord[];  // 所有开单记录
  done: boolean;
}
