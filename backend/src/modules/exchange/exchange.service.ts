import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Environment, ExchangeName } from '../../common/constants/enums';
import type { ExchangeAdapter } from './adapters/exchange-adapter';
import { BinanceAdapter, extractAvgPrice, resolveMarginCurrency, testBinanceConnection } from './adapters/binance.adapter';
import { LighterAdapter, testLighterConnection } from './adapters/lighter.adapter';
import type {
  BalanceInfo,
  KlineInfo,
  OpenOrderInfo,
  OrderResult,
  PlaceOrderParams,
  PositionInfo,
  PositionSideParam,
  TickerInfo,
} from './exchange.types';

export type {
  PlaceOrderParams,
  OrderResult,
  OpenOrderInfo,
  PositionInfo,
  BalanceInfo,
  TickerInfo,
  KlineInfo,
} from './exchange.types';

export type { ExchangeAdapter } from './adapters/exchange-adapter';

/**
 * 交易所服务：按 ApiConfig 创建/缓存适配器，并按策略侧（LONG/SHORT）解析账户。
 */
@Injectable()
export class ExchangeService implements OnModuleDestroy {
  private readonly logger = new Logger(ExchangeService.name);
  private readonly adapterCache = new Map<string, ExchangeAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 根据 ApiConfig 创建适配器
   */
  async createAdapter(apiConfig: {
    id: string;
    exchange: string;
    environment: string;
    apiKey: string;
    apiSecret: string;
    accountIndex?: number | null | bigint;
    apiKeyIndex?: number | null;
  }): Promise<ExchangeAdapter> {
    const cacheKey = `id:${apiConfig.id}`;
    const cached = this.adapterCache.get(cacheKey);
    if (cached) return cached;

    const apiKey = this.cryptoService.decrypt(apiConfig.apiKey);
    const apiSecret = this.cryptoService.decrypt(apiConfig.apiSecret);
    const exchangeName = apiConfig.exchange.toUpperCase();

    let adapter: ExchangeAdapter;

    if (exchangeName === ExchangeName.BINANCE) {
      const binance = new BinanceAdapter(
        apiConfig.id,
        apiConfig.environment,
        apiKey,
        apiSecret,
      );
      await binance.init();
      adapter = binance;
      this.logger.log(
        `Created Binance adapter ${apiConfig.environment} id=${apiConfig.id}`,
      );
    } else if (exchangeName === ExchangeName.LIGHTER) {
      if (apiConfig.accountIndex == null || apiConfig.apiKeyIndex == null) {
        throw new Error(
          'Lighter ApiConfig requires accountIndex and apiKeyIndex',
        );
      }
      adapter = new LighterAdapter(
        apiConfig.id,
        apiConfig.environment,
        apiSecret,
        Number(apiConfig.accountIndex),
        apiConfig.apiKeyIndex,
      );
      this.logger.log(
        `Created Lighter adapter ${apiConfig.environment} account=${apiConfig.accountIndex} id=${apiConfig.id}`,
      );
    } else {
      throw new Error(`Unsupported exchange: ${apiConfig.exchange}`);
    }

    this.adapterCache.set(cacheKey, adapter);
    return adapter;
  }

  /** @deprecated 使用 createAdapter */
  async createExchange(apiConfig: {
    id: string;
    exchange: string;
    environment: string;
    apiKey: string;
    apiSecret: string;
    accountIndex?: number | null | bigint;
    apiKeyIndex?: number | null;
  }): Promise<ExchangeAdapter> {
    return this.createAdapter(apiConfig);
  }

  /**
   * 按策略 + 持仓侧解析适配器。
   * Binance / 无 shortApiConfig：两侧共用 apiConfigId。
   * Lighter：LONG → apiConfigId，SHORT → shortApiConfigId。
   */
  async getAdapterForStrategy(
    strategyId: string,
    side: PositionSideParam = 'LONG',
  ): Promise<ExchangeAdapter> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      include: { apiConfig: true, shortApiConfig: true },
    });
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    let apiConfig =
      side === 'SHORT' && strategy.shortApiConfig
        ? strategy.shortApiConfig
        : strategy.apiConfig;

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
      throw new Error(
        'No ApiConfig available. Please configure exchange API first.',
      );
    }

    if (
      side === 'SHORT' &&
      apiConfig.exchange === ExchangeName.LIGHTER &&
      !strategy.shortApiConfig
    ) {
      throw new Error(
        'Lighter strategy requires shortApiConfigId for SHORT leg',
      );
    }

    return this.createAdapter({
      id: apiConfig.id,
      exchange: apiConfig.exchange,
      environment: apiConfig.environment,
      apiKey: apiConfig.apiKey,
      apiSecret: apiConfig.apiSecret,
      accountIndex: apiConfig.accountIndex,
      apiKeyIndex: apiConfig.apiKeyIndex,
    });
  }

  /** 兼容旧调用：默认多腿账户 */
  async getExchangeForStrategy(strategyId: string): Promise<ExchangeAdapter> {
    return this.getAdapterForStrategy(strategyId, 'LONG');
  }

  /**
   * 返回策略绑定的全部适配器（去重）。用于 TP/SL 监控、孤儿单扫描。
   */
  async getAdaptersForStrategy(strategyId: string): Promise<ExchangeAdapter[]> {
    const long = await this.getAdapterForStrategy(strategyId, 'LONG');
    const adapters = [long];
    try {
      const short = await this.getAdapterForStrategy(strategyId, 'SHORT');
      if (short.apiConfigId !== long.apiConfigId) {
        adapters.push(short);
      }
    } catch {
      /* 无空腿 */
    }
    return adapters;
  }

  /** 按 ApiConfig.id 取适配器（孤儿单清理指定子账户） */
  async getAdapterByApiConfigId(apiConfigId: string): Promise<ExchangeAdapter> {
    const apiConfig = await this.prisma.apiConfig.findUnique({
      where: { id: apiConfigId },
    });
    if (!apiConfig) {
      throw new Error(`ApiConfig not found: ${apiConfigId}`);
    }
    return this.createAdapter({
      id: apiConfig.id,
      exchange: apiConfig.exchange,
      environment: apiConfig.environment,
      apiKey: apiConfig.apiKey,
      apiSecret: apiConfig.apiSecret,
      accountIndex: apiConfig.accountIndex,
      apiKeyIndex: apiConfig.apiKeyIndex,
    });
  }

  async getExchangeForEnvironment(environment: string): Promise<ExchangeAdapter> {
    const apiConfig = await this.prisma.apiConfig.findFirst({
      where: { environment, isActive: true },
    });
    if (!apiConfig) {
      throw new Error(`No active ApiConfig for environment: ${environment}`);
    }
    return this.createAdapter({
      id: apiConfig.id,
      exchange: apiConfig.exchange,
      environment: apiConfig.environment,
      apiKey: apiConfig.apiKey,
      apiSecret: apiConfig.apiSecret,
      accountIndex: apiConfig.accountIndex,
      apiKeyIndex: apiConfig.apiKeyIndex,
    });
  }

  clearCache(apiConfigId?: string): void {
    if (apiConfigId) {
      const existing = this.adapterCache.get(`id:${apiConfigId}`);
      existing?.destroy?.();
      this.adapterCache.delete(`id:${apiConfigId}`);
      this.logger.log(`Exchange cache cleared for apiConfig ${apiConfigId}`);
    } else {
      for (const a of this.adapterCache.values()) {
        a.destroy?.();
      }
      this.adapterCache.clear();
      this.logger.log('Exchange cache cleared');
    }
  }

  // ============ 委托到适配器（保持旧签名，第一参数为 adapter） ============

  async placeOrder(
    exchange: ExchangeAdapter,
    params: PlaceOrderParams,
  ): Promise<OrderResult> {
    return exchange.placeOrder(params);
  }

  extractAvgPrice(result: any): number | undefined {
    return extractAvgPrice(result);
  }

  async resolveFillPrice(
    exchange: ExchangeAdapter,
    orderResult: OrderResult,
    symbol: string,
  ): Promise<number> {
    if (orderResult.avgPrice && orderResult.avgPrice > 0) {
      return orderResult.avgPrice;
    }
    const fromRaw = this.extractAvgPrice(orderResult.raw);
    if (fromRaw) return fromRaw;

    if (orderResult.id) {
      try {
        const fetched = await this.fetchOrder(exchange, orderResult.id, symbol);
        if (fetched.avgPrice && fetched.avgPrice > 0) return fetched.avgPrice;
        const again = this.extractAvgPrice(fetched.raw);
        if (again) return again;
      } catch (e) {
        this.logger.warn(
          `resolveFillPrice fetchOrder(${orderResult.id}) failed: ${(e as Error).message}`,
        );
      }
    }

    const ticker = await this.fetchTicker(exchange, symbol);
    if (!ticker.lastPrice || ticker.lastPrice <= 0) {
      throw new Error(`Unable to resolve fill price for ${symbol}`);
    }
    this.logger.warn(
      `resolveFillPrice fallback to live ticker last=${ticker.lastPrice} for ${symbol}`,
    );
    return ticker.lastPrice;
  }

  async fetchOrder(
    exchange: ExchangeAdapter,
    orderId: string,
    symbol: string,
  ): Promise<OrderResult> {
    return exchange.fetchOrder(orderId, symbol);
  }

  private static readonly REST_TIMEOUT_MS = 15_000;

  async withTimeout<T>(
    promise: Promise<T>,
    label: string,
    ms = ExchangeService.REST_TIMEOUT_MS,
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

  async fetchOpenOrders(
    exchange: ExchangeAdapter,
    symbol?: string,
  ): Promise<OpenOrderInfo[]> {
    return exchange.fetchOpenOrders(symbol);
  }

  async cancelOrder(
    exchange: ExchangeAdapter,
    orderId: string,
    symbol: string,
  ): Promise<void> {
    return exchange.cancelOrder(orderId, symbol);
  }

  async closePosition(
    exchange: ExchangeAdapter,
    symbol: string,
    side: 'LONG' | 'SHORT',
    quantity: number,
  ): Promise<OrderResult> {
    return exchange.closePosition(symbol, side, quantity);
  }

  async setLeverage(
    exchange: ExchangeAdapter,
    symbol: string,
    leverage: number,
  ): Promise<void> {
    return exchange.setLeverage(symbol, leverage);
  }

  async setMarginMode(
    exchange: ExchangeAdapter,
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSSED',
  ): Promise<void> {
    return exchange.setMarginMode(symbol, marginMode);
  }

  async setPositionMode(
    exchange: ExchangeAdapter,
    dualSide: boolean,
  ): Promise<void> {
    return exchange.setPositionMode(dualSide);
  }

  async fetchPositions(
    exchange: ExchangeAdapter,
    symbols?: string[],
  ): Promise<PositionInfo[]> {
    return exchange.fetchPositions(symbols);
  }

  resolveMarginCurrency(symbol?: string): string {
    return resolveMarginCurrency(symbol);
  }

  async fetchBalance(
    exchange: ExchangeAdapter,
    opts?: { symbol?: string; currency?: string },
  ): Promise<BalanceInfo> {
    return exchange.fetchBalance(opts);
  }

  async fetchTicker(
    exchange: ExchangeAdapter,
    symbol: string,
  ): Promise<TickerInfo> {
    return exchange.fetchTicker(symbol);
  }

  async fetchKlines(
    exchange: ExchangeAdapter,
    symbol: string,
    interval: string,
    limit: number = 100,
  ): Promise<KlineInfo[]> {
    if (!exchange.fetchKlines) {
      throw new Error(
        `Exchange ${exchange.exchangeName} does not support fetchKlines`,
      );
    }
    return exchange.fetchKlines(symbol, interval, limit);
  }

  /**
   * 测试 API 连通性（支持 Binance / Lighter）
   */
  async testConnection(
    apiKey: string,
    apiSecret: string,
    environment: string,
    opts?: {
      exchange?: string;
      accountIndex?: number;
      apiKeyIndex?: number;
    },
  ): Promise<boolean> {
    const exchange = (opts?.exchange || ExchangeName.BINANCE).toUpperCase();
    if (exchange === ExchangeName.LIGHTER) {
      if (opts?.accountIndex == null || opts?.apiKeyIndex == null) {
        this.logger.error('Lighter test requires accountIndex and apiKeyIndex');
        return false;
      }
      const res = await testLighterConnection({
        privateKey: apiSecret,
        accountIndex: opts.accountIndex,
        apiKeyIndex: opts.apiKeyIndex,
        environment,
      });
      if (!res.ok) {
        this.logger.error(`Lighter connection test failed: ${res.message}`);
      }
      return res.ok;
    }
    return testBinanceConnection(apiKey, apiSecret, environment);
  }

  async testConnectionDetailed(opts: {
    exchange: string;
    environment: string;
    apiKey: string;
    apiSecret: string;
    accountIndex?: number;
    apiKeyIndex?: number;
  }): Promise<{ success: boolean; message: string; latency?: number }> {
    const exchange = opts.exchange.toUpperCase();
    if (exchange === ExchangeName.LIGHTER) {
      if (opts.accountIndex == null || opts.apiKeyIndex == null) {
        return {
          success: false,
          message: 'Lighter 需要 accountIndex 与 apiKeyIndex',
        };
      }
      const res = await testLighterConnection({
        privateKey: opts.apiSecret,
        accountIndex: opts.accountIndex,
        apiKeyIndex: opts.apiKeyIndex,
        environment: opts.environment,
      });
      return {
        success: res.ok,
        message: res.ok ? '连接成功' : res.message || '连接失败',
        latency: res.latencyMs,
      };
    }
    const start = Date.now();
    const ok = await testBinanceConnection(
      opts.apiKey,
      opts.apiSecret,
      opts.environment,
    );
    return {
      success: ok,
      message: ok ? '连接成功' : '连接失败,请检查 API Key/Secret 和网络',
      latency: Date.now() - start,
    };
  }

  async subscribeWebSocket(
    _exchange: ExchangeAdapter,
    channel: string,
    symbol: string,
    _callback: (data: any) => void,
  ): Promise<void> {
    this.logger.warn(
      `subscribeWebSocket(${channel}, ${symbol}) - not implemented for adapters`,
    );
  }

  onModuleDestroy(): void {
    for (const a of this.adapterCache.values()) {
      a.destroy?.();
    }
    this.adapterCache.clear();
  }
}
