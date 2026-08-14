export interface PlaceOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  closePosition?: boolean;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
}

export interface OrderResult {
  id: string;
  status: string;
  filledQty: number;
  avgPrice?: number;
  raw?: any;
}

export interface OpenOrderInfo {
  id: string;
  symbol: string;
  type: string;
  side: string;
  status: string;
  price?: number;
  stopPrice?: number;
  amount: number;
  filled: number;
  /** 挂单时间（交易所）ms */
  timestamp: number;
  datetime?: string;
  positionSide?: string;
  reduceOnly?: boolean;
  /** 客户端订单号（Lighter client_order_index）；用于与本地 exchangeOrderId 对齐 */
  clientOrderId?: string;
  /** 拉取该挂单所用的 ApiConfig.id（双子账户扫描时区分来源） */
  apiConfigId?: string;
  raw?: any;
}

export interface PositionInfo {
  symbol: string;
  side: 'LONG' | 'SHORT';
  contracts: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: string;
  liquidationPrice?: number;
  markPrice?: number;
}

export interface BalanceInfo {
  total: number;
  free: number;
  used: number;
  currency: string;
}

export interface TickerInfo {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  timestamp: number;
}

export interface KlineInfo {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

export type PositionSideParam = 'LONG' | 'SHORT';
