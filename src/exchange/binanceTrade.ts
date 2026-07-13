/**
 * BinanceTrade — Binance 合约交易 API 封装
 *
 * 支持多实例：实盘 / 测试网
 * 每个实例有自己的 baseUrl、API Key 和 Secret
 */

import crypto from 'crypto';
import { config } from '../config.js';

// ========== 类型定义 ==========

export interface PositionInfo {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  leverage: number;
}

export interface AccountInfo {
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  availableBalance: number;
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  executedQty: number;
  cumQuote: number;
  avgPrice: number;
  status: string;
}

export interface BinanceTradeOptions {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  quantityPrecision?: number;
  pricePrecision?: number;
}

// ========== BinanceTrade 类 ==========

export class BinanceTrade {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private quantityPrecision: number;
  private pricePrecision: number;

  constructor(opts: BinanceTradeOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.quantityPrecision = opts.quantityPrecision ?? 6;
    this.pricePrecision = opts.pricePrecision ?? 1;
  }

  /** 是否有 API Key 配置 */
  hasApiKey(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
  }

  private async signedRequest(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number> = {}) {
    if (!this.hasApiKey()) throw new Error('未配置 Binance API Key/Secret');

    const timestamp = Date.now();
    const queryObj = { ...params, timestamp };
    const query = Object.entries(queryObj)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const signature = this.sign(query);

    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Binance API 错误 (${res.status}): ${JSON.stringify(data)}`);
    }
    return data;
  }

  private async publicGet(path: string, params: Record<string, string | number> = {}) {
    const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
    const url = `${this.baseUrl}${path}${query ? '?' + query : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(`Binance API 错误 (${res.status}): ${JSON.stringify(data)}`);
    return data;
  }

  // ========== 交易 API ==========

  /** 市价开仓/加仓 */
  async marketOpen(side: 'BUY' | 'SELL', quantity: number, positionSide?: string, symbol?: string): Promise<OrderResult> {
    const sym = (symbol || config.symbol).toUpperCase();
    const qty = quantity.toFixed(this.quantityPrecision);

    const params: Record<string, string | number> = {
      symbol: sym, side, type: 'MARKET', quantity: qty,
      newOrderRespType: 'RESULT',
    };
    if (positionSide) params.positionSide = positionSide;

    const data = await this.signedRequest('POST', '/fapi/v1/order', params);

    return {
      orderId: data.orderId,
      symbol: data.symbol,
      executedQty: parseFloat(data.executedQty),
      cumQuote: parseFloat(data.cumQuote),
      avgPrice: parseFloat(data.avgPrice),
      status: data.status,
    };
  }

  /** 市价平仓指定数量（部分减仓） */
  async marketClose(side: 'BUY' | 'SELL', quantity: number, positionSide?: string, symbol?: string): Promise<OrderResult> {
    return this.marketOpen(side, quantity, positionSide, symbol);
  }

  /** 挂止盈止损 reduce-only 单 */
  async placeReduceOrder(
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number,
    type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET',
    symbol?: string,
  ): Promise<OrderResult> {
    const sym = (symbol || config.symbol).toUpperCase();
    const qty = quantity.toFixed(this.quantityPrecision);
    const price = stopPrice.toFixed(this.pricePrecision);

    const data = await this.signedRequest('POST', '/fapi/v1/order', {
      symbol: sym,
      side,
      type,
      quantity: qty,
      stopPrice: price,
      positionSide: side === 'BUY' ? 'LONG' : 'SHORT',
      newOrderRespType: 'RESULT',
    });

    return {
      orderId: data.orderId,
      symbol: data.symbol,
      executedQty: parseFloat(data.executedQty),
      cumQuote: parseFloat(data.cumQuote),
      avgPrice: parseFloat(data.avgPrice),
      status: data.status,
    };
  }

  /** 取消所有止盈止损挂单 */
  async cancelAllOrders(symbol?: string) {
    const sym = (symbol || config.symbol).toUpperCase();
    try {
      await this.signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol: sym });
    } catch {
      // 忽略无订单时的错误
    }
  }

  /** 查询当前未成交挂单 */
  async getOpenOrders(symbol?: string): Promise<{
    orderId: number;
    side: string;
    type: string;
    stopPrice: string;
    origQty: string;
    status: string;
  }[]> {
    const sym = (symbol || config.symbol).toUpperCase();
    const data = await this.signedRequest('GET', '/fapi/v1/openOrders', { symbol: sym });
    return data;
  }

  /** 设置双向持仓模式（Hedge Mode）— 同时持有多/空仓位 */
  async setHedgeMode(): Promise<boolean> {
    try {
      const data = await this.signedRequest('POST', '/fapi/v1/positionSide/dual', {
        dualSidePosition: 'true',
      });
      return data.code === 200 || data.msg === 'success';
    } catch (err) {
      const msg = (err as Error).message;
      // 如果已是 Hedge Mode，Binance 会返回错误，忽略
      if (msg.includes('-4060') || msg.includes('Already')
        || msg.includes('No need to change')) {
        return true;
      }
      throw err;
    }
  }

  /** 设置合约杠杆 */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const sym = symbol.toUpperCase();
    try {
      await this.signedRequest('POST', '/fapi/v1/leverage', {
        symbol: sym,
        leverage: Math.max(1, Math.min(125, Math.round(leverage))),
      });
    } catch (err) {
      // 如果杠杆已设置，Binance 可能返回错误，忽略
    }
  }

  /** 查询当前持仓模式 */
  async getPosition(symbol?: string): Promise<PositionInfo | null> {
    const sym = (symbol || config.symbol).toUpperCase();
    const data = await this.signedRequest('GET', '/fapi/v2/positionRisk', { symbol: sym });
    if (!data || data.length === 0) return null;

    const pos = data[0];
    const amt = parseFloat(pos.positionAmt);

    if (Math.abs(amt) < 1e-8) return null;

    return {
      symbol: pos.symbol,
      positionAmt: amt,
      entryPrice: parseFloat(pos.entryPrice),
      markPrice: parseFloat(pos.markPrice),
      unrealizedProfit: parseFloat(pos.unrealizedProfit),
      leverage: parseFloat(pos.leverage),
    };
  }

  /** 查询账户余额 */
  async getBalance(): Promise<AccountInfo> {
    const data = await this.signedRequest('GET', '/fapi/v2/account');
    return {
      totalWalletBalance: parseFloat(data.totalWalletBalance),
      totalUnrealizedProfit: parseFloat(data.totalUnrealizedProfit),
      availableBalance: parseFloat(data.availableBalance),
    };
  }

  /** 测试 API Key 是否有效 */
  async testConnection(): Promise<boolean> {
    try {
      await this.getBalance();
      return true;
    } catch {
      return false;
    }
  }

  /** 获取最新价格 */
  async getCurrentPrice(symbol?: string): Promise<number> {
    const sym = (symbol || config.symbol).toUpperCase();
    const data = await this.publicGet('/fapi/v1/ticker/price', { symbol: sym });
    return parseFloat(data.price);
  }

  // ========== 工具函数 ==========

  /** 计算开仓数量（根据保证金+杠杆+价格） */
  calcQuantity(marginUsd: number, leverage: number, price: number): number {
    return (marginUsd * leverage) / price;
  }
}

// ========== 工厂函数 & 单例 ==========

/** 创建实盘实例 */
export function createProductionTrade(): BinanceTrade {
  return new BinanceTrade({
    baseUrl: config.binanceFapiBase,
    apiKey: config.binanceApiKey,
    apiSecret: config.binanceApiSecret,
  });
}

/** 创建测试网实例 */
export function createTestnetTrade(): BinanceTrade {
  return new BinanceTrade({
    baseUrl: config.binanceTestnetBase,
    apiKey: config.binanceTestnetApiKey,
    apiSecret: config.binanceTestnetApiSecret,
    quantityPrecision: 4,
    pricePrecision: 2,
  });
}

// ========== 模块级单例 ==========

/** 实盘实例 */
export const prodTrade = createProductionTrade();

/** 测试网实例（仅当有测试网 Key 时可用） */
export const testnetTrade = createTestnetTrade();

// ========== 向后兼容导出 ==========
// 保持旧版 `import * as bTrade` 可用
export const hasApiKey = () => prodTrade.hasApiKey();
export const testConnection = () => prodTrade.testConnection();
export const getBalance = () => prodTrade.getBalance();
export const getPosition = (symbol?: string) => prodTrade.getPosition(symbol);
export const getOpenOrders = (symbol?: string) => prodTrade.getOpenOrders(symbol);
export const marketOpen = (side: 'BUY' | 'SELL', quantity: number, symbol?: string) => prodTrade.marketOpen(side, quantity, symbol);
export const marketClose = (side: 'BUY' | 'SELL', quantity: number, symbol?: string) => prodTrade.marketClose(side, quantity, symbol);
export const placeReduceOrder = (side: 'BUY' | 'SELL', quantity: number, stopPrice: number, type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET', symbol?: string) => prodTrade.placeReduceOrder(side, quantity, stopPrice, type, symbol);
export const cancelAllOrders = (symbol?: string) => prodTrade.cancelAllOrders(symbol);
export const calcQuantity = (marginUsd: number, leverage: number, price: number) => prodTrade.calcQuantity(marginUsd, leverage, price);
export const getCurrentPrice = (symbol?: string) => prodTrade.getCurrentPrice(symbol);
