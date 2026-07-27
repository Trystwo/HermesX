// ============ 基础枚举 ============
export type Environment = 'TESTNET' | 'LIVE'
export type StrategyStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'ARMED'
  | 'OPENING'
  | 'MONITORING'
  | 'CLOSING'
  | 'DONE'
  | 'ERROR'
export type PositionStatus = 'OPEN' | 'TP_HIT' | 'SL_HIT' | 'CLOSED' | 'MANUAL'
export type CycleInterval = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d'
export type Side = 'LONG' | 'SHORT'
export type QuantityType = 'BY_QUANTITY' | 'BY_NOTIONAL'
export type OrderType = 'OPEN' | 'TP' | 'SL' | 'MANUAL_CLOSE' | 'CLOSE_ALL'
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELED' | 'FAILED'

// ============ 用户 ============
export interface User {
  id: number
  username: string
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

// ============ 策略 ============
export interface Strategy {
  id: string | number
  name: string
  symbol: string
  cycleInterval: CycleInterval
  quantity: number
  quantityType: QuantityType
  leverage: number
  takeProfitPct: number
  stopLossPct: number
  maxPositions: number
  marginMode: 'CROSSED' | 'ISOLATED'
  /** 本地价格触及 TP/SL 时是否主动市价平仓 */
  localAutoCloseEnabled: boolean
  apiConfigId: string | number | null
  status: StrategyStatus
  isActive?: boolean
  environment: Environment
  createdAt: string
  updatedAt: string
}

export interface CreateStrategyInput {
  name: string
  symbol: string
  cycleInterval: CycleInterval
  quantity: number
  quantityType: QuantityType
  leverage: number
  takeProfitPct: number
  stopLossPct: number
  maxPositions: number
  marginMode: 'CROSSED' | 'ISOLATED'
  localAutoCloseEnabled: boolean
  apiConfigId: string | number | null
}

export type UpdateStrategyInput = Partial<CreateStrategyInput>

// ============ 持仓 ============
export interface Position {
  id: string
  cycleId: string
  strategyId: string
  strategyName?: string
  symbol: string
  side: Side
  quantity: number
  entryPrice: number
  currentPrice?: number
  markPrice?: number
  takeProfitPrice: number | null
  stopLossPrice: number | null
  unrealizedPnl?: number
  realizedPnl: number | null
  margin?: number
  leverage?: number
  status: PositionStatus
  environment: Environment
  /** 开仓时间（cycleOpenTime / createdAt） */
  openedAt: string
  /** 最近一次 TP 条件单创建时间 */
  tpPlacedAt?: string | null
  /** 最近一次 SL 条件单创建时间 */
  slPlacedAt?: string | null
  closedAt: string | null
  hasPendingTp?: boolean
  hasPendingSl?: boolean
  /** OPEN 且缺少 PENDING TP 或 SL */
  needsTpSl?: boolean
}

// ============ 订单 ============
export interface Order {
  id: string
  orderId: string
  strategyId: string
  strategyName?: string
  symbol: string
  side: Side
  type: OrderType
  quantity: number
  price: number
  avgFillPrice: number | null
  status: OrderStatus
  environment: Environment
  positionId: string | null
  cycleId: string | null
  createdAt: string
  updatedAt: string
}

// ============ 交易日志 ============
export interface TradeLog {
  id: number
  strategyId: number
  symbol: string
  side: Side
  quantity: number
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPct: number
  fee: number
  reason: 'TP' | 'SL' | 'MANUAL'
  cycleId: string
  environment: Environment
  openedAt: string
  closedAt: string
}

// ============ 统计 ============
export interface Stats {
  totalPnl: number
  totalPnlPct: number
  winRate: number
  totalTrades: number
  winTrades: number
  lossTrades: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  activePositions: number
  dailyPnl: DailyPnl[]
}

export interface DailyPnl {
  date: string
  pnl: number
  trades: number
  cumulative: number
}

// ============ 行情 ============
export interface Ticker {
  symbol: string
  lastPrice: number
  priceChange: number
  priceChangePct: number
  high: number
  low: number
  volume: number
  timestamp: number
}

export interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface LeverageBracket {
  bracket: number
  initialLeverage: number
  notionalCap: number
  notionalFloor: number
  maintMarginRatio: number
  cum: number
}

export interface SymbolInfo {
  symbol: string
  baseAsset: string
  quoteAsset: string
  pricePrecision: number
  quantityPrecision: number
  status: string
}

// ============ 账户 ============
export interface Balance {
  totalBalance: number
  availableBalance: number
  usedMargin: number
  unrealizedPnl: number
  marginRatio: number
  environment: Environment
}

// ============ API 配置 ============
export interface ApiConfig {
  id: string | number
  exchange: string
  environment: Environment
  apiKeyMasked: string
  apiSecretMasked: string
  status: 'ACTIVE' | 'INVALID' | 'UNTESTED'
  createdAt: string
  lastTestedAt: string | null
}

export interface CreateApiConfigInput {
  exchange: string
  environment: Environment
  apiKey: string
  apiSecret: string
}

export interface TestConnectionResult {
  success: boolean
  message: string
  latency?: number
}

// ============ 风控 ============
export interface RiskParams {
  maxDrawdownPct: number
  maxDailyLossPct: number
  maxOpenPositions: number
  maxLeverage: number
  emergencyStopEnabled: boolean
}

// ============ 告警 ============
export interface Alert {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
  message: string
  timestamp: number
  source: string
}

// ============ 回测 ============
export type BacktestJobType = 'SINGLE' | 'GRID'
export type BacktestJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
export type BacktestSampleType = 'FULL' | 'IN_SAMPLE' | 'OUT_OF_SAMPLE'
export type GridSortBy =
  | 'totalPnl'
  | 'winRate'
  | 'maxDrawdown'
  | 'profitFactor'
  | 'totalTrades'

export interface BacktestStrategyParams {
  cycleInterval: CycleInterval
  quantity: number
  quantityType: QuantityType
  leverage: number
  takeProfitPct: number
  stopLossPct: number
  maxPositions: number
}

export interface BacktestFeeConfig {
  enabled: boolean
  openFeeRate: number
  closeFeeRate: number
}

export interface BacktestSlippageConfig {
  enabled: boolean
  pct: number
  fixedPoints?: number
}

export interface BacktestSampleSplit {
  enabled: boolean
  mode: 'ratio' | 'date'
  inSampleRatio?: number
  splitAt?: string
}

export interface BacktestGridLists {
  cycleInterval?: CycleInterval[]
  takeProfitPct?: number[]
  stopLossPct?: number[]
  leverage?: number[]
  quantity?: number[]
}

export interface CreateBacktestInput {
  type: BacktestJobType
  symbol: string
  startTime: string
  endTime: string
  /** 初始资金 USDT，净值曲线起点 */
  initialBalance?: number
  params: BacktestStrategyParams
  fee?: Partial<BacktestFeeConfig>
  slippage?: Partial<BacktestSlippageConfig>
  grid?: BacktestGridLists
  sortBy?: GridSortBy
  topN?: number
  sampleSplit?: BacktestSampleSplit
}

export interface BacktestStats {
  totalPnl: number
  winRate: number
  maxDrawdown: number
  maxDrawdownPct: number
  profitFactor: number
  totalTrades: number
  winTrades: number
  lossTrades: number
  avgWin: number
  avgLoss: number
  totalFee: number
  totalSlippageCost: number
  grossPnl: number
}

export interface BacktestTradeDetail {
  cycleId: string
  side: Side
  openTime: number
  closeTime: number
  openAssumedPrice: number
  openFillPrice: number
  closeAssumedPrice: number
  closeFillPrice: number
  quantity: number
  grossPnl: number
  openFee: number
  closeFee: number
  totalFee: number
  openSlippageCost: number
  closeSlippageCost: number
  totalSlippageCost: number
  netPnl: number
  exitReason: 'TP' | 'SL' | 'EOD'
  takeProfitPrice: number
  stopLossPrice: number
}

/** 引擎净值曲线采样点（含盯市） */
export interface EquityCurvePoint {
  t: number
  equity: number
  realizedNet: number
  fees: number
  unrealized: number
  openCount: number
}

export interface BacktestResult {
  id: string
  jobId: string
  sampleType: BacktestSampleType
  params: BacktestStrategyParams
  stats: BacktestStats
  trades: BacktestTradeDetail[] | null
  curve: EquityCurvePoint[] | null
  rank: number | null
  isTop: boolean
  createdAt: string
}

export interface BacktestJob {
  id: string
  type: BacktestJobType
  status: BacktestJobStatus
  symbol: string
  startTime: string
  endTime: string
  config: CreateBacktestInput
  error: string | null
  createdAt: string
  updatedAt: string
  results?: BacktestResult[]
}

export interface BacktestMeta {
  defaults: {
    openFeeRate: number
    closeFeeRate: number
    slippagePct: number
    initialBalance: number
    feeNote: string
    slippageNote: string
    equityNote?: string
  }
  limits: {
    maxBacktestDays: number
    maxKlines: number
    maxGridCombinations: number
  }
}
