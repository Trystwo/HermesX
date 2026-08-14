import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { ExchangeService, type ExchangeAdapter } from '../exchange/exchange.service';
import { Environment } from '../../common/constants/enums';

export interface TickerData {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  timestamp: number;
}

/**
 * 行情服务
 * - 维护内存价格表(Map)，带短 TTL，避免脏价长期滞留
 * - 优先用 LIVE 公共行情（与 TESTNET 价格不可混用）
 * - 写入 Redis(供其他服务/进程共享)
 */
@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketService.name);
  private readonly priceMap = new Map<string, TickerData>();
  private readonly subscriptions = new Set<string>();
  private redis: Redis | null = null;
  private redisConnected = false;
  /** 内存缓存最长有效期；超过则强制重新拉取 */
  private readonly CACHE_MAX_AGE_MS = 5_000;

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initRedis();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis disconnected');
    }
  }

  private async initRedis(): Promise<void> {
    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password') || undefined;

    try {
      this.redis = new Redis({
        host,
        port,
        password: password || undefined,
        retryStrategy: (times) => {
          if (times > 10) {
            this.logger.error('Redis reconnection attempts exhausted');
            return null;
          }
          return Math.min(times * 500, 5000);
        },
      });

      this.redis.on('connect', () => {
        this.redisConnected = true;
        this.logger.log('Redis connected');
      });

      this.redis.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
        this.redisConnected = false;
      });

      this.redis.on('reconnecting', () => {
        this.logger.warn('Redis reconnecting...');
      });
    } catch (e) {
      this.logger.warn(`Redis init failed, running without cache: ${(e as Error).message}`);
    }
  }

  /**
   * 行情优先走实盘（TESTNET 价与实盘差很大，且部分 USDC 合约可能缺失）
   * 返回 ExchangeAdapter（Binance 或 Lighter 公共/带钥客户端均可 fetchTicker）
   */
  private async getQuoteExchange(): Promise<ExchangeAdapter> {
    try {
      return await this.exchangeService.getExchangeForEnvironment(Environment.LIVE);
    } catch {
      return await this.exchangeService.getExchangeForEnvironment(Environment.TESTNET);
    }
  }

  subscribe(symbol: string): void {
    this.subscriptions.add(symbol);
    this.logger.log(`Subscribed to ${symbol}, total: ${this.subscriptions.size}`);
  }

  unsubscribe(symbol: string): void {
    this.subscriptions.delete(symbol);
    this.logger.log(`Unsubscribed ${symbol}, remaining: ${this.subscriptions.size}`);
  }

  /**
   * 获取最新价格(优先未过期内存缓存,其次 Redis,最后实时查询)
   */
  async getPrice(symbol: string): Promise<number> {
    const cached = this.priceMap.get(symbol);
    if (cached && Date.now() - cached.timestamp <= this.CACHE_MAX_AGE_MS) {
      return cached.lastPrice;
    }

    if (this.redisConnected && this.redis) {
      const raw = await this.redis.get(`market:price:${symbol}`);
      if (raw) {
        const n = parseFloat(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    try {
      const exchange = await this.getQuoteExchange();
      const ticker = await this.exchangeService.fetchTicker(exchange, symbol);
      this.updatePrice(symbol, ticker);
      return ticker.lastPrice;
    } catch (e) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${(e as Error).message}`);
      // 过期缓存兜底，避免整轮周期因行情短暂失败中断
      if (cached?.lastPrice) return cached.lastPrice;
      throw e;
    }
  }

  async getTicker(symbol: string): Promise<TickerData> {
    const cached = this.priceMap.get(symbol);
    if (cached && Date.now() - cached.timestamp <= this.CACHE_MAX_AGE_MS) {
      return cached;
    }
    const exchange = await this.getQuoteExchange();
    const ticker = await this.exchangeService.fetchTicker(exchange, symbol);
    this.updatePrice(symbol, ticker);
    return ticker;
  }

  async getKlines(symbol: string, interval: string, limit: number = 100) {
    const exchange = await this.getQuoteExchange();
    try {
      return await this.exchangeService.fetchKlines(exchange, symbol, interval, limit);
    } catch (e) {
      // Lighter 首版不提供 OHLCV：回退 Binance public（仅行情/回测辅助）
      this.logger.warn(
        `fetchKlines via ${exchange.exchangeName} failed, fallback Binance public: ${(e as Error).message}`,
      );
      const { default: ccxt } = await import('ccxt');
      const publicEx = new ccxt.binance({
        enableRateLimit: true,
        options: { defaultType: 'future', fetchMarkets: ['linear'], fetchCurrencies: false },
      });
      const ohlcv = await publicEx.fetchOHLCV(symbol, interval, undefined, limit);
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

  @Cron('*/2 * * * * *')
  private async refreshPrices(): Promise<void> {
    if (this.subscriptions.size === 0) return;

    const symbols = Array.from(this.subscriptions);
    try {
      const exchange = await this.getQuoteExchange();
      const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
          const ticker = await this.exchangeService.fetchTicker(exchange, symbol);
          this.updatePrice(symbol, ticker);
        }),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        this.logger.debug(`Refreshed ${symbols.length} symbols, ${failed} failed`);
      }
    } catch (e) {
      this.logger.error(`Price refresh batch failed: ${(e as Error).message}`);
    }
  }

  private updatePrice(symbol: string, ticker: TickerData): void {
    const withTs: TickerData = {
      ...ticker,
      timestamp: ticker.timestamp || Date.now(),
    };
    this.priceMap.set(symbol, withTs);
    if (this.redisConnected && this.redis) {
      this.redis
        .set(`market:price:${symbol}`, withTs.lastPrice.toString(), 'EX', 30)
        .catch((e) => this.logger.warn(`Redis write failed for ${symbol}: ${e.message}`));
      this.redis
        .set(`market:ticker:${symbol}`, JSON.stringify(withTs), 'EX', 30)
        .catch(() => {});
    }
  }

  getAllPrices(): TickerData[] {
    return Array.from(this.priceMap.values());
  }
}
