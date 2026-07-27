import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ccxt, { Exchange } from 'ccxt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Environment } from '../../common/constants/enums';

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

/**
 * 交易所服务 - ccxt 封装
 * 支持 TESTNET/LIVE 双环境隔离
 * 内部维护 exchange 实例缓存
 */
@Injectable()
export class ExchangeService implements OnModuleDestroy {
  private readonly logger = new Logger(ExchangeService.name);
  private readonly exchangeCache = new Map<string, Exchange>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 根据 ApiConfig 创建交易所实例
   * TESTNET 调用 setSandboxMode(true)
   */
  async createExchange(apiConfig: {
    id: string;
    exchange: string;
    environment: string;
    apiKey: string;
    apiSecret: string;
  }): Promise<Exchange> {
    const cacheKey = `${apiConfig.exchange}:${apiConfig.environment}`;

    const cached = this.exchangeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const apiKey = this.cryptoService.decrypt(apiConfig.apiKey);
    const apiSecret = this.cryptoService.decrypt(apiConfig.apiSecret);

    let exchange: Exchange;
    const exchangeName = apiConfig.exchange.toLowerCase();

    if (exchangeName === 'binance') {
      exchange = new ccxt.binance({
        apiKey,
        secret: apiSecret,
        enableRateLimit: true,
        recvWindow: 10000,
        options: {
          defaultType: 'future', // 合约
          fetchMarkets: ['linear'], // 只加载 U 本位合约，避免 loadMarkets 命中现货端点
          fetchCurrencies: false, // 禁用货币信息查询（命中 spot /sapi 端点）
          // 自动根据交易所时间校准本地时间偏移，缓解 -1021 ahead/behind 报错
          adjustForTimeDifference: true,
        },
      });
    } else {
      throw new Error(`Unsupported exchange: ${apiConfig.exchange}`);
    }

    // 模拟盘/实盘隔离
    if (apiConfig.environment === Environment.TESTNET) {
      // Binance 已废弃 setSandboxMode for futures，手动替换域名
      const originalUrls = JSON.stringify((exchange as any).urls);
      const testnetUrls = originalUrls.replace(/fapi\.binance\.com/g, 'testnet.binancefuture.com');
      (exchange as any).urls = JSON.parse(testnetUrls);
      this.logger.log(`Created TESTNET exchange instance for ${apiConfig.exchange} (manual URL)`);
    } else {
      this.logger.log(`Created LIVE exchange instance for ${apiConfig.exchange}`);
    }

    // 私有接口（余额/下单）依赖签名时间戳，启动时主动同步一次服务器时间偏移。
    try {
      await exchange.loadTimeDifference();
    } catch (e) {
      this.logger.warn(
        `Failed to sync exchange time difference for ${apiConfig.exchange}:${apiConfig.environment}: ${(e as Error).message}`,
      );
    }

    this.exchangeCache.set(cacheKey, exchange);
    return exchange;
  }

  /**
   * 从数据库读取策略绑定的 ApiConfig,创建/缓存交易所实例
   */
  async getExchangeForStrategy(strategyId: string): Promise<Exchange> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      include: { apiConfig: true },
    });
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    let apiConfig = strategy.apiConfig;

    // 未绑定配置时：优先 DEFAULT_ENVIRONMENT，避免误用实盘密钥
    if (!apiConfig) {
      const defaultEnv =
        this.configService.get<string>('defaultEnvironment') ||
        Environment.TESTNET;
      apiConfig = await this.prisma.apiConfig.findFirst({
        where: { environment: defaultEnv, isActive: true },
      });
      if (!apiConfig) {
        apiConfig = await this.prisma.apiConfig.findFirst({
          where: { environment: Environment.TESTNET, isActive: true },
        });
      }
    }

    if (!apiConfig) {
      throw new Error('No ApiConfig available. Please configure exchange API first.');
    }

    return this.createExchange({
      id: apiConfig.id,
      exchange: apiConfig.exchange,
      environment: apiConfig.environment,
      apiKey: apiConfig.apiKey,
      apiSecret: apiConfig.apiSecret,
    });
  }

  /**
   * 根据环境获取默认交易所实例
   */
  async getExchangeForEnvironment(environment: string): Promise<Exchange> {
    const apiConfig = await this.prisma.apiConfig.findFirst({
      where: { environment, isActive: true },
    });
    if (!apiConfig) {
      throw new Error(`No active ApiConfig for environment: ${environment}`);
    }
    return this.createExchange({
      id: apiConfig.id,
      exchange: apiConfig.exchange,
      environment: apiConfig.environment,
      apiKey: apiConfig.apiKey,
      apiSecret: apiConfig.apiSecret,
    });
  }

  /**
   * 清除指定环境的缓存(配置更新时调用)
   */
  clearCache(environment?: string): void {
    if (environment) {
      const keysToDelete: string[] = [];
      for (const key of this.exchangeCache.keys()) {
        if (key.endsWith(`:${environment}`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((k) => this.exchangeCache.delete(k));
    } else {
      this.exchangeCache.clear();
    }
    this.logger.log(`Exchange cache cleared${environment ? ` for ${environment}` : ''}`);
  }

  // ============ 交易方法 ============

  async placeOrder(exchange: Exchange, params: PlaceOrderParams): Promise<OrderResult> {
    // ccxt createOrder 签名: (symbol, type, side, amount, price?, params?)
    // 额外的 Binance futures 参数放在 params 对象中
    const extraParams: any = {};
    if (params.stopPrice !== undefined) extraParams.stopPrice = params.stopPrice;
    if (params.reduceOnly !== undefined) extraParams.reduceOnly = params.reduceOnly;
    if (params.closePosition !== undefined) extraParams.closePosition = params.closePosition;
    if (params.positionSide !== undefined) extraParams.positionSide = params.positionSide;

    const result = await exchange.createOrder(
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
      filledQty: result.filled || 0,
      avgPrice: result.average,
      raw: result,
    };
  }

  /**
   * 查询单个订单状态（用于同步 TP/SL 条件单是否已成交）
   */
  async fetchOrder(
    exchange: Exchange,
    orderId: string,
    symbol: string,
  ): Promise<OrderResult> {
    const result = await exchange.fetchOrder(orderId, symbol);
    return {
      id: result.id ?? orderId,
      status: result.status || 'unknown',
      filledQty: result.filled || 0,
      avgPrice: result.average ?? result.price ?? undefined,
      raw: result,
    };
  }

  /**
   * 查询当前未成交挂单。
   * Binance U本位条件单已迁到 Algo API：普通 openOrders 不含 TP/SL，
   * 需同时拉 fapi openAlgoOrders（含 createTime 挂单时间）。
   */
  async fetchOpenOrders(
    exchange: Exchange,
    symbol?: string,
  ): Promise<OpenOrderInfo[]> {
    const regular = symbol
      ? await exchange.fetchOpenOrders(symbol)
      : await exchange.fetchOpenOrders();

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

    const fromAlgo = await this.fetchOpenAlgoOrders(exchange, symbol);
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

  /**
   * Binance 条件单（STOP_MARKET / TAKE_PROFIT_MARKET）开放挂单
   * GET /fapi/v1/openAlgoOrders — 返回 algoId + createTime
   */
  async fetchOpenAlgoOrders(
    exchange: Exchange,
    symbol?: string,
  ): Promise<OpenOrderInfo[]> {
    try {
      const params: Record<string, string> = {};
      if (symbol) {
        params.symbol = symbol.includes('/')
          ? symbol.split(':')[0].replace('/', '')
          : symbol.replace(/[:/]/g, '').replace(/USDTUSDT$/, 'USDT');
      }
      const raw = await (exchange as any).fapiPrivateGetOpenAlgoOrders(params);
      const list: any[] = Array.isArray(raw) ? raw : raw?.orders ?? [];
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
      this.logger.warn(
        `fetchOpenAlgoOrders failed: ${(e as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 取消订单：普通单走 cancelOrder；条件单（algoId）走 deleteAlgoOrder
   */
  async cancelOrder(
    exchange: Exchange,
    orderId: string,
    symbol: string,
  ): Promise<void> {
    try {
      await exchange.cancelOrder(orderId, symbol);
      return;
    } catch (e) {
      const msg = (e as Error).message || '';
      if (
        msg.includes('-2011') ||
        msg.includes('-2013') ||
        msg.toLowerCase().includes('unknown order') ||
        msg.toLowerCase().includes('does not exist')
      ) {
        await (exchange as any).fapiPrivateDeleteAlgoOrder({ algoId: orderId });
        return;
      }
      try {
        await (exchange as any).fapiPrivateDeleteAlgoOrder({ algoId: orderId });
        return;
      } catch {
        throw e;
      }
    }
  }

  async closePosition(
    exchange: Exchange,
    symbol: string,
    side: 'LONG' | 'SHORT',
    quantity: number,
  ): Promise<OrderResult> {
    // 平仓: 反向市价单 + positionSide（Hedge Mode）
    // 注意: 双向持仓模式下传 positionSide 时不能再传 reduceOnly，
    // 否则币安返回 -1106 Parameter 'reduceonly' sent when not required.
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    return this.placeOrder(exchange, {
      symbol,
      side: closeSide as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity,
      positionSide: side,
    });
  }

  async setLeverage(exchange: Exchange, symbol: string, leverage: number): Promise<void> {
    try {
      await (exchange as any).setLeverage(leverage, symbol);
      this.logger.log(`Set leverage ${leverage}x for ${symbol}`);
    } catch (e) {
      this.logger.warn(`setLeverage failed for ${symbol}: ${(e as Error).message}`);
      // 某些情况下杠杆已设置会报错,忽略
    }
  }

  async setMarginMode(
    exchange: Exchange,
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSSED',
  ): Promise<void> {
    try {
      const mode = marginMode.toLowerCase();
      await (exchange as any).setMarginMode(mode, symbol);
      this.logger.log(`Set margin mode ${marginMode} for ${symbol}`);
    } catch (e) {
      this.logger.warn(`setMarginMode failed for ${symbol}: ${(e as Error).message}`);
    }
  }

  async setPositionMode(exchange: Exchange, dualSide: boolean): Promise<void> {
    try {
      await (exchange as any).setPositionMode(dualSide);
      this.logger.log(`Set position mode dualSide=${dualSide}`);
    } catch (e) {
      this.logger.warn(`setPositionMode failed: ${(e as Error).message}`);
    }
  }

  async fetchPositions(exchange: Exchange, symbols?: string[]): Promise<PositionInfo[]> {
    const positions = await exchange.fetchPositions(symbols);
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

  async fetchBalance(exchange: Exchange): Promise<BalanceInfo> {
    const balance = await exchange.fetchBalance();
    const usdt = (balance as any).USDT || (balance as any).total || {};
    return {
      total: usdt.total || 0,
      free: usdt.free || 0,
      used: usdt.used || 0,
      currency: 'USDT',
    };
  }

  async fetchTicker(exchange: Exchange, symbol: string): Promise<TickerInfo> {
    const ticker = await exchange.fetchTicker(symbol);
    return {
      symbol: ticker.symbol ?? '',
      lastPrice: ticker.last || 0,
      bid: ticker.bid || 0,
      ask: ticker.ask || 0,
      timestamp: ticker.timestamp || Date.now(),
    };
  }

  async fetchKlines(
    exchange: Exchange,
    symbol: string,
    interval: string,
    limit: number = 100,
  ): Promise<KlineInfo[]> {
    const ohlcv = await exchange.fetchOHLCV(symbol, interval, undefined, limit);
    return ohlcv.map((k: any) => ({
      timestamp: k[0],
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: k[5],
    }));
  }

  /**
   * 测试 API 连通性
   */
  async testConnection(apiKey: string, apiSecret: string, environment: string): Promise<boolean> {
    const exchange = new ccxt.binance({
      apiKey,
      secret: apiSecret,
      options: {
        defaultType: 'future',
        fetchMarkets: ['linear'],
        fetchCurrencies: false,
      },
    });

    if (environment === Environment.TESTNET) {
      const originalUrls = JSON.stringify((exchange as any).urls);
      (exchange as any).urls = JSON.parse(
        originalUrls.replace(/fapi\.binance\.com/g, 'testnet.binancefuture.com'),
      );
    }

    try {
      await exchange.fetchBalance();
      return true;
    } catch (e) {
      this.logger.error(`API connection test failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 订阅 WebSocket - ccxt.pro 的 watchOrders / watchTicker
   * 注意: 需要安装 ccxt.pro,此处提供接口占位
   */
  async subscribeWebSocket(
    exchange: Exchange,
    channel: string,
    symbol: string,
    callback: (data: any) => void,
  ): Promise<void> {
    // ccxt.pro 需要单独的 pro 实例
    // 此处为接口预留,实际实现依赖 ccxt.pro
    this.logger.warn(
      `subscribeWebSocket(${channel}, ${symbol}) - 需要 ccxt.pro 支持,请配置 market.service 的原生 WebSocket`,
    );
  }

  onModuleDestroy(): void {
    this.exchangeCache.clear();
  }
}
