import type {
  BalanceInfo,
  ConnectionTestResult,
  KlineInfo,
  OpenOrderInfo,
  OrderResult,
  PlaceOrderParams,
  PositionInfo,
  PositionSideParam,
  TickerInfo,
} from '../exchange.types';

/**
 * 统一交易所适配器：Binance / Lighter 等实现同一套交易面。
 */
export interface ExchangeAdapter {
  readonly exchangeName: string;
  readonly environment: string;
  readonly apiConfigId: string;
  /** 是否支持同账户双向持仓（Binance hedge）；Lighter 为 false */
  readonly supportsHedgeMode: boolean;

  testConnection(): Promise<ConnectionTestResult>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginMode(symbol: string, marginMode: 'ISOLATED' | 'CROSSED'): Promise<void>;
  setPositionMode(dualSide: boolean): Promise<void>;
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  fetchOrder(orderId: string, symbol: string): Promise<OrderResult>;
  fetchOpenOrders(symbol?: string): Promise<OpenOrderInfo[]>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  closePosition(
    symbol: string,
    side: PositionSideParam,
    quantity: number,
  ): Promise<OrderResult>;
  fetchPositions(symbols?: string[]): Promise<PositionInfo[]>;
  fetchBalance(opts?: { symbol?: string; currency?: string }): Promise<BalanceInfo>;
  fetchTicker(symbol: string): Promise<TickerInfo>;
  fetchKlines?(
    symbol: string,
    interval: string,
    limit?: number,
  ): Promise<KlineInfo[]>;
  destroy?(): Promise<void> | void;
}
