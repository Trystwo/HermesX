import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { ExchangeService } from '../exchange/exchange.service';
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
 * - 维护内存价格表(Map)
 * - 写入 Redis(供其他服务/进程共享)
 * - 定时轮询订阅的 symbol(不依赖 ccxt.pro)
 * - 断线重连(Redis)
 *
 * 说明: Binance 合约 WebSocket 需要单独实现,此处使用 REST 轮询作为基础方案。
 * 后续可替换为 ccxt.pro 或原生 ws 客户端。
 */
@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketService.name);
  private readonly priceMap = new Map<string, TickerData>();
  private readonly subscriptions = new Set<string>();
  private redis: Redis | null = null;
  private redisConnected = false;

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
   * 订阅 symbol 行情
   */
  subscribe(symbol: string): void {
    this.subscriptions.add(symbol);
    this.logger.log(`Subscribed to ${symbol}, total: ${this.subscriptions.size}`);
  }

  /**
   * 取消订阅
   */
  unsubscribe(symbol: string): void {
    this.subscriptions.delete(symbol);
    this.logger.log(`Unsubscribed ${symbol}, remaining: ${this.subscriptions.size}`);
  }

  /**
   * 获取最新价格(优先内存,其次 Redis,最后实时查询)
   */
  async getPrice(symbol: string): Promise<number> {
    const cached = this.priceMap.get(symbol);
    if (cached) {
      return cached.lastPrice;
    }

    if (this.redisConnected && this.redis) {
      const raw = await this.redis.get(`market:price:${symbol}`);
      if (raw) {
        return parseFloat(raw);
      }
    }

    // 实时查询
    try {
      const exchange = await this.exchangeService.getExchangeForEnvironment(Environment.TESTNET);
      const ticker = await this.exchangeService.fetchTicker(exchange, symbol);
      this.updatePrice(symbol, ticker);
      return ticker.lastPrice;
    } catch (e) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${(e as Error).message}`);
      throw e;
    }
  }

  /**
   * 获取完整 Ticker
   */
  async getTicker(symbol: string): Promise<TickerData> {
    const cached = this.priceMap.get(symbol);
    if (cached) {
      return cached;
    }
    const exchange = await this.exchangeService.getExchangeForEnvironment(Environment.TESTNET);
    const ticker = await this.exchangeService.fetchTicker(exchange, symbol);
    this.updatePrice(symbol, ticker);
    return ticker;
  }

  /**
   * 获取 K 线
   */
  async getKlines(symbol: string, interval: string, limit: number = 100) {
    const exchange = await this.exchangeService.getExchangeForEnvironment(Environment.TESTNET);
    return this.exchangeService.fetchKlines(exchange, symbol, interval, limit);
  }

  /**
   * 定时刷新订阅的行情(每 2 秒)
   */
  @Cron('*/2 * * * * *')
  private async refreshPrices(): Promise<void> {
    if (this.subscriptions.size === 0) return;

    const symbols = Array.from(this.subscriptions);
    try {
      const exchange = await this.exchangeService.getExchangeForEnvironment(Environment.TESTNET);
      // 并发拉取
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
    this.priceMap.set(symbol, ticker);
    // 写入 Redis(异步,失败不阻塞)
    if (this.redisConnected && this.redis) {
      this.redis
        .set(`market:price:${symbol}`, ticker.lastPrice.toString(), 'EX', 30)
        .catch((e) => this.logger.warn(`Redis write failed for ${symbol}: ${e.message}`));
      this.redis
        .set(`market:ticker:${symbol}`, JSON.stringify(ticker), 'EX', 30)
        .catch(() => {});
    }
  }

  /**
   * 获取所有缓存价格
   */
  getAllPrices(): TickerData[] {
    return Array.from(this.priceMap.values());
  }
}
