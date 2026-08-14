import { Logger } from '@nestjs/common';
import ccxt, { Exchange } from 'ccxt';
import { Environment } from '../../../common/constants/enums';
import type { ExchangeAdapter } from './exchange-adapter';
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

const REST_TIMEOUT_MS = 15_000;

export class BinanceAdapter implements ExchangeAdapter {
  readonly exchangeName = 'BINANCE';
  readonly supportsHedgeMode = true;
  private readonly logger = new Logger(BinanceAdapter.name);
  private readonly exchange: Exchange;

  constructor(
    readonly apiConfigId: string,
    readonly environment: string,
    apiKey: string,
    apiSecret: string,
  ) {
    this.exchange = new ccxt.binance({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      recvWindow: 10000,
      options: {
        defaultType: 'future',
        fetchMarkets: ['linear'],
        fetchCurrencies: false,
        adjustForTimeDifference: true,
      },
    });

    if (environment === Environment.TESTNET) {
      const originalUrls = JSON.stringify((this.exchange as any).urls);
      const testnetUrls = originalUrls.replace(
        /fapi\.binance\.com/g,
        'testnet.binancefuture.com',
      );
      (this.exchange as any).urls = JSON.parse(testnetUrls);
    }
  }

  async init(): Promise<void> {
    try {
      await this.exchange.loadTimeDifference();
    } catch (e) {
      this.logger.warn(
        `Failed to sync Binance time difference: ${(e as Error).message}`,
      );
    }
  }

  get rawExchange(): Exchange {
    return this.exchange;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      await this.exchange.fetchBalance();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: (e as Error).message,
      };
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      await (this.exchange as any).setLeverage(leverage, symbol);
      this.logger.log(`Set leverage ${leverage}x for ${symbol}`);
    } catch (e) {
      this.logger.warn(`setLeverage failed for ${symbol}: ${(e as Error).message}`);
    }
  }

  async setMarginMode(
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSSED',
  ): Promise<void> {
    try {
      await (this.exchange as any).setMarginMode(marginMode.toLowerCase(), symbol);
      this.logger.log(`Set margin mode ${marginMode} for ${symbol}`);
    } catch (e) {
      this.logger.warn(
        `setMarginMode failed for ${symbol}: ${(e as Error).message}`,
      );
    }
  }

  async setPositionMode(dualSide: boolean): Promise<void> {
    try {
      await (this.exchange as any).setPositionMode(dualSide);
      this.logger.log(`Set position mode dualSide=${dualSide}`);
    } catch (e) {
      this.logger.warn(`setPositionMode failed: ${(e as Error).message}`);
    }
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const extraParams: any = {};
    if (params.stopPrice !== undefined) extraParams.stopPrice = params.stopPrice;
    if (params.reduceOnly !== undefined) extraParams.reduceOnly = params.reduceOnly;
    if (params.closePosition !== undefined) {
      extraParams.closePosition = params.closePosition;
    }
    if (params.positionSide !== undefined) {
      extraParams.positionSide = params.positionSide;
    }

    const result = await this.exchange.createOrder(
      params.symbol,
      params.type.toLowerCase() as any,
      params.side.toLowerCase() as any,
      params.quantity,
      params.price,
      extraParams,
    );

    return {
      id: result.id ?? '',
      status: result.status || 'OPEN',
      filledQty:
        Number(result.filled) ||
        Number((result as any).info?.executedQty) ||
        0,
      avgPrice: extractAvgPrice(result),
      raw: result,
    };
  }

  async fetchOrder(orderId: string, symbol: string): Promise<OrderResult> {
    const result = await this.exchange.fetchOrder(orderId, symbol);
    return {
      id: result.id ?? orderId,
      status: result.status || 'unknown',
      filledQty: result.filled || Number((result as any).info?.executedQty) || 0,
      avgPrice: extractAvgPrice(result),
      raw: result,
    };
  }

  async fetchOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const regular = await withTimeout(
      symbol
        ? this.exchange.fetchOpenOrders(symbol)
        : this.exchange.fetchOpenOrders(),
      `fetchOpenOrders(${symbol ?? 'ALL'})`,
    );

    const fromRegular: OpenOrderInfo[] = (regular || []).map((o: any) => ({
      id: String(o.id ?? ''),
      symbol: o.symbol ?? symbol ?? '',
      type: String(o.type ?? o.info?.type ?? '').toLowerCase(),
      side: String(o.side ?? '').toLowerCase(),
      status: String(o.status ?? 'open').toLowerCase(),
      price: o.price != null ? Number(o.price) : undefined,
      stopPrice:
        o.stopPrice != null
          ? Number(o.stopPrice)
          : o.info?.stopPrice != null
            ? Number(o.info.stopPrice)
            : undefined,
      amount: Number(o.amount ?? 0),
      filled: Number(o.filled ?? 0),
      timestamp: Number(o.timestamp ?? o.info?.time ?? o.info?.updateTime ?? 0),
      datetime:
        o.datetime ??
        (o.timestamp ? new Date(o.timestamp).toISOString() : undefined),
      positionSide: o.info?.positionSide ?? o.positionSide,
      reduceOnly: o.reduceOnly ?? o.info?.reduceOnly,
      raw: o,
    }));

    const fromAlgo = await this.fetchOpenAlgoOrders(symbol);
    const seen = new Set(fromRegular.map((o) => o.id));
    const merged = [...fromRegular];
    for (const o of fromAlgo) {
      if (o.id && !seen.has(o.id)) {
        merged.push(o);
        seen.add(o.id);
      }
    }
    return merged;
  }

  private async fetchOpenAlgoOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const params: Record<string, string> = {};
    if (symbol) {
      params.symbol = symbol.includes('/')
        ? symbol.split(':')[0].replace('/', '')
        : symbol.replace(/[:/]/g, '').replace(/USDTUSDT$/, 'USDT');
    }
    try {
      const raw = await withTimeout(
        (this.exchange as any).fapiPrivateGetOpenAlgoOrders(params),
        `fetchOpenAlgoOrders(${params.symbol ?? 'ALL'})`,
      );
      const list: any[] = Array.isArray(raw)
        ? raw
        : ((raw as { orders?: any[] } | null)?.orders ?? []);
      return list.map((o) => {
        const createTime = Number(o.createTime ?? o.bookTime ?? o.updateTime ?? 0);
        return {
          id: String(o.algoId ?? o.orderId ?? ''),
          symbol: o.symbol ?? symbol ?? '',
          type: String(o.orderType ?? o.type ?? '').toLowerCase(),
          side: String(o.side ?? '').toLowerCase(),
          status: String(o.algoStatus ?? o.status ?? 'NEW').toLowerCase(),
          price: o.price != null ? Number(o.price) : undefined,
          stopPrice:
            o.triggerPrice != null
              ? Number(o.triggerPrice)
              : o.stopPrice != null
                ? Number(o.stopPrice)
                : undefined,
          amount: Number(o.quantity ?? o.totalQty ?? 0),
          filled: Number(o.actualQty ?? o.executedQty ?? 0),
          timestamp: createTime,
          datetime: createTime ? new Date(createTime).toISOString() : undefined,
          positionSide: o.positionSide,
          reduceOnly: o.reduceOnly,
          raw: o,
        } satisfies OpenOrderInfo;
      });
    } catch (e) {
      this.logger.warn(`fetchOpenAlgoOrders failed: ${(e as Error).message}`);
      throw e;
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    try {
      await withTimeout(
        this.exchange.cancelOrder(orderId, symbol),
        `cancelOrder(${orderId})`,
      );
      return;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.toLowerCase().includes('timed out')) throw e;

      if (
        msg.includes('-2011') ||
        msg.includes('-2013') ||
        msg.toLowerCase().includes('unknown order') ||
        msg.toLowerCase().includes('does not exist')
      ) {
        await withTimeout(
          (this.exchange as any).fapiPrivateDeleteAlgoOrder({ algoId: orderId }),
          `deleteAlgoOrder(${orderId})`,
        );
        return;
      }
      try {
        await withTimeout(
          (this.exchange as any).fapiPrivateDeleteAlgoOrder({ algoId: orderId }),
          `deleteAlgoOrder(${orderId})`,
        );
        return;
      } catch {
        throw e;
      }
    }
  }

  async closePosition(
    symbol: string,
    side: PositionSideParam,
    quantity: number,
  ): Promise<OrderResult> {
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    return this.placeOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity,
      positionSide: side,
    });
  }

  async fetchPositions(symbols?: string[]): Promise<PositionInfo[]> {
    const positions = await this.exchange.fetchPositions(symbols);
    return positions
      .filter((p: any) => p && p.contracts && p.contracts > 0)
      .map((p: any) => ({
        symbol: p.symbol,
        side: (p.side || 'long').toUpperCase() as 'LONG' | 'SHORT',
        contracts: p.contracts,
        entryPrice: p.entryPrice,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage,
        marginMode: p.marginMode || 'isolated',
        liquidationPrice: p.liquidationPrice,
        markPrice: p.markPrice,
      }));
  }

  async fetchBalance(opts?: {
    symbol?: string;
    currency?: string;
  }): Promise<BalanceInfo> {
    const balance = await this.exchange.fetchBalance();
    const currency = opts?.currency ?? resolveMarginCurrency(opts?.symbol);
    const asset = (balance as any)[currency] || {};
    return {
      total: Number(asset.total) || 0,
      free: Number(asset.free) || 0,
      used: Number(asset.used) || 0,
      currency,
    };
  }

  async fetchTicker(symbol: string): Promise<TickerInfo> {
    const ticker = await this.exchange.fetchTicker(symbol);
    return {
      symbol: ticker.symbol ?? '',
      lastPrice: ticker.last || 0,
      bid: ticker.bid || 0,
      ask: ticker.ask || 0,
      timestamp: ticker.timestamp || Date.now(),
    };
  }

  async fetchKlines(
    symbol: string,
    interval: string,
    limit: number = 100,
  ): Promise<KlineInfo[]> {
    const ohlcv = await this.exchange.fetchOHLCV(
      symbol,
      interval,
      undefined,
      limit,
    );
    return ohlcv.map((k: any) => ({
      timestamp: k[0],
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: k[5],
    }));
  }
}

export function extractAvgPrice(result: any): number | undefined {
  const candidates = [
    result?.average,
    result?.info?.avgPrice,
    result?.info?.avg_price,
    result?.filled && result?.price ? result.price : undefined,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export function resolveMarginCurrency(symbol?: string): string {
  if (!symbol) return 'USDT';
  const s = symbol.replace(/[:/]/g, '').toUpperCase();
  if (s.endsWith('USDC')) return 'USDC';
  if (s.endsWith('BUSD')) return 'BUSD';
  return 'USDT';
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = REST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 无密钥的 Binance 连接测试（明文 key） */
export async function testBinanceConnection(
  apiKey: string,
  apiSecret: string,
  environment: string,
): Promise<boolean> {
  const adapter = new BinanceAdapter('test', environment, apiKey, apiSecret);
  const res = await adapter.testConnection();
  return res.ok;
}
