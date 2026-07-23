/**
 * 历史行情拉取与缓存
 * 使用公开 ccxt 实例拉取 OHLCV，不调用任何下单接口
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ccxt, { Exchange } from 'ccxt';
import Redis from 'ioredis';
import type { KlineInfo } from '../exchange/exchange.service';
import { INTERVAL_MS, MAX_BACKTEST_DAYS, MAX_KLINES } from './backtest.constants';

@Injectable()
export class KlineFetcherService {
  private readonly logger = new Logger(KlineFetcherService.name);
  private publicExchange: Exchange | null = null;
  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initRedis();
  }

  private initRedis(): void {
    try {
      const host = this.configService.get<string>('redis.host') || 'localhost';
      const port = this.configService.get<number>('redis.port') || 6379;
      const password = this.configService.get<string>('redis.password') || undefined;
      this.redis = new Redis({
        host,
        port,
        password: password || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.redis.connect().catch(() => {
        this.logger.warn('Redis unavailable for kline cache, using memory-only fetch');
        this.redis = null;
      });
    } catch {
      this.redis = null;
    }
  }

  /**
   * 获取（或创建）无密钥的公开行情交易所实例 —— 仅用于 fetchOHLCV
   */
  private getPublicExchange(): Exchange {
    if (this.publicExchange) return this.publicExchange;

    this.publicExchange = new ccxt.binance({
      enableRateLimit: true,
      options: {
        defaultType: 'future',
        fetchMarkets: ['linear'],
        fetchCurrencies: false,
      },
    });
    return this.publicExchange;
  }

  /**
   * 拉取指定区间历史 K 线（带 Redis 缓存），并做跨度 / 数量校验
   */
  async fetchRange(
    symbol: string,
    interval: string,
    startTime: Date,
    endTime: Date,
  ): Promise<KlineInfo[]> {
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) {
      throw new BadRequestException(`不支持的周期: ${interval}`);
    }

    const start = startTime.getTime();
    const end = endTime.getTime();
    if (!(end > start)) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }

    const spanDays = (end - start) / 86_400_000;
    if (spanDays > MAX_BACKTEST_DAYS) {
      throw new BadRequestException(
        `回测时间跨度不得超过 ${MAX_BACKTEST_DAYS} 天（当前约 ${spanDays.toFixed(1)} 天）`,
      );
    }

    const estimated = Math.ceil((end - start) / intervalMs) + 2;
    if (estimated > MAX_KLINES) {
      throw new BadRequestException(
        `预估 K 线数量 ${estimated} 超过上限 ${MAX_KLINES}，请缩小区间或加大周期`,
      );
    }

    const cacheKey = `backtest:klines:${symbol}:${interval}:${start}:${end}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Kline cache hit: ${cacheKey}`);
          return JSON.parse(cached) as KlineInfo[];
        }
      } catch {
        // 缓存失败不影响主流程
      }
    }

    const klines = await this.fetchPaginated(symbol, interval, start, end);
    if (klines.length > MAX_KLINES) {
      throw new BadRequestException(
        `实际 K 线数量 ${klines.length} 超过上限 ${MAX_KLINES}`,
      );
    }

    if (this.redis && klines.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(klines), 'EX', 3600);
      } catch {
        // ignore
      }
    }

    return klines;
  }

  /**
   * 分页拉取 OHLCV，直到覆盖 endTime
   */
  private async fetchPaginated(
    symbol: string,
    interval: string,
    start: number,
    end: number,
  ): Promise<KlineInfo[]> {
    const exchange = this.getPublicExchange();
    // ccxt 统一符号：BTC/USDT:USDT
    const marketSymbol = this.toCcxtSymbol(symbol);
    const all: KlineInfo[] = [];
    let since = start;
    const limit = 1000;
    let guard = 0;

    while (since < end && guard < 50) {
      guard += 1;
      const ohlcv = await exchange.fetchOHLCV(marketSymbol, interval, since, limit);
      if (!ohlcv || ohlcv.length === 0) break;

      for (const k of ohlcv) {
        const ts = k[0] as number;
        if (ts < start) continue;
        if (ts >= end) continue;
        all.push({
          timestamp: ts,
          open: k[1] as number,
          high: k[2] as number,
          low: k[3] as number,
          close: k[4] as number,
          volume: k[5] as number,
        });
      }

      const lastTs = ohlcv[ohlcv.length - 1][0] as number;
      const next = lastTs + (INTERVAL_MS[interval] || 60_000);
      if (next <= since) break;
      since = next;

      if (ohlcv.length < limit) break;
    }

    // 去重并排序，保证可复现
    const map = new Map<number, KlineInfo>();
    for (const k of all) map.set(k.timestamp, k);
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /** BTCUSDT → BTC/USDT:USDT */
  private toCcxtSymbol(symbol: string): string {
    const s = symbol.replace('/', '').toUpperCase();
    if (s.endsWith('USDT')) {
      const base = s.slice(0, -4);
      return `${base}/USDT:USDT`;
    }
    return symbol;
  }
}
