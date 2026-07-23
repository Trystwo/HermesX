/**
 * 回测任务编排服务
 * - 创建任务、异步执行、持久化结果
 * - 单次回测 / 网格搜索 / 样本内外验证
 * - 全程不调用真实下单接口
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BacktestJobStatus,
  BacktestJobType,
  BacktestSampleType,
  DEFAULT_CLOSE_FEE_RATE,
  DEFAULT_GRID_TOP_N,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_OPEN_FEE_RATE,
  DEFAULT_SLIPPAGE_PCT,
  type GridSortBy,
} from './backtest.constants';
import { BacktestEngineService } from './backtest-engine.service';
import { CreateBacktestDto } from './dto/create-backtest.dto';
import type { FeeConfig } from './fee-calculator';
import { GridSearchService } from './grid-search.service';
import { KlineFetcherService } from './kline-fetcher.service';
import { filterKlinesByRange, splitSampleRange } from './sample-split';
import type { SlippageConfig } from './slippage-calculator';
import type { BacktestStrategyParams } from './backtest.types';
import type { KlineInfo } from '../exchange/exchange.service';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);
  /** 防止同一进程内堆积过多并发回测 */
  private runningCount = 0;
  private readonly maxConcurrent = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: BacktestEngineService,
    private readonly gridSearch: GridSearchService,
    private readonly klineFetcher: KlineFetcherService,
  ) {}

  /**
   * 创建回测任务并异步执行
   */
  async create(dto: CreateBacktestDto) {
    this.validateDto(dto);

    if (this.runningCount >= this.maxConcurrent) {
      throw new BadRequestException('回测任务繁忙，请稍后再试');
    }

    const job = await this.prisma.backtestJob.create({
      data: {
        type: dto.type,
        status: BacktestJobStatus.PENDING,
        symbol: dto.symbol.toUpperCase().replace('/', ''),
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        config: dto as object,
      },
    });

    // 异步执行，不阻塞 HTTP
    setImmediate(() => {
      this.executeJob(job.id).catch((e) =>
        this.logger.error(`Backtest job ${job.id} failed: ${(e as Error).message}`),
      );
    });

    return job;
  }

  async findAll(limit = 50) {
    return this.prisma.backtestJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        results: {
          where: { isTop: true },
          orderBy: { rank: 'asc' },
          take: 5,
        },
      },
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.backtestJob.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: [{ sampleType: 'asc' }, { rank: 'asc' }],
        },
      },
    });
    if (!job) throw new NotFoundException(`回测任务不存在: ${id}`);
    return job;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.backtestJob.delete({ where: { id } });
    return { ok: true };
  }

  // ============ 执行 ============

  private async executeJob(jobId: string): Promise<void> {
    this.runningCount += 1;
    try {
      await this.prisma.backtestJob.update({
        where: { id: jobId },
        data: { status: BacktestJobStatus.RUNNING },
      });

      const job = await this.prisma.backtestJob.findUnique({ where: { id: jobId } });
      if (!job) return;

      const dto = job.config as unknown as CreateBacktestDto;
      const fee = this.resolveFee(dto);
      const slippage = this.resolveSlippage(dto);
      const sampleCfg = {
        enabled: dto.sampleSplit?.enabled ?? false,
        mode: (dto.sampleSplit?.mode || 'ratio') as 'ratio' | 'date',
        inSampleRatio: dto.sampleSplit?.inSampleRatio ?? 0.7,
        splitAt: dto.sampleSplit?.splitAt,
      };

      if (dto.type === BacktestJobType.SINGLE) {
        await this.runSingle(jobId, job.symbol, job.startTime, job.endTime, dto, fee, slippage, sampleCfg);
      } else {
        await this.runGrid(jobId, job.symbol, job.startTime, job.endTime, dto, fee, slippage, sampleCfg);
      }

      await this.prisma.backtestJob.update({
        where: { id: jobId },
        data: { status: BacktestJobStatus.COMPLETED, error: null },
      });
    } catch (e) {
      const msg = (e as Error).message || 'unknown error';
      this.logger.error(`Job ${jobId} error: ${msg}`);
      await this.prisma.backtestJob.update({
        where: { id: jobId },
        data: { status: BacktestJobStatus.FAILED, error: msg },
      });
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
  }

  private async runSingle(
    jobId: string,
    symbol: string,
    startTime: Date,
    endTime: Date,
    dto: CreateBacktestDto,
    fee: FeeConfig,
    slippage: SlippageConfig,
    sampleCfg: {
      enabled: boolean;
      mode: 'ratio' | 'date';
      inSampleRatio?: number;
      splitAt?: string;
    },
  ): Promise<void> {
    const params = this.toStrategyParams(dto);
    const allKlines = await this.klineFetcher.fetchRange(
      symbol,
      params.cycleInterval,
      startTime,
      endTime,
    );

    if (!sampleCfg.enabled) {
      const output = this.engine.run({
        symbol,
        params,
        fee,
        slippage,
        initialBalance: this.resolveInitialBalance(dto),
        klines: allKlines,
      });
      await this.prisma.backtestResult.create({
        data: {
          jobId,
          sampleType: BacktestSampleType.FULL,
          params: params as object,
          stats: output.stats as object,
          trades: output.trades as object,
          curve: output.equityCurve as object,
          rank: 1,
          isTop: true,
        },
      });
      return;
    }

    // 样本内外：同参数分别跑两段并对比
    const windows = splitSampleRange(startTime, endTime, sampleCfg);
    const isKlines = filterKlinesByRange(allKlines, windows.inSampleStart, windows.inSampleEnd);
    const oosKlines = filterKlinesByRange(
      allKlines,
      windows.outSampleStart,
      windows.outSampleEnd,
      true,
    );

    const initialBalance = this.resolveInitialBalance(dto);
    const isOut = this.engine.run({
      symbol,
      params,
      fee,
      slippage,
      initialBalance,
      klines: isKlines,
    });
    const oosOut = this.engine.run({
      symbol,
      params,
      fee,
      slippage,
      initialBalance,
      klines: oosKlines,
    });

    await this.prisma.backtestResult.createMany({
      data: [
        {
          jobId,
          sampleType: BacktestSampleType.IN_SAMPLE,
          params: params as object,
          stats: isOut.stats as object,
          trades: isOut.trades as object,
          curve: isOut.equityCurve as object,
          rank: 1,
          isTop: true,
        },
        {
          jobId,
          sampleType: BacktestSampleType.OUT_OF_SAMPLE,
          params: params as object,
          stats: oosOut.stats as object,
          trades: oosOut.trades as object,
          curve: oosOut.equityCurve as object,
          rank: 1,
          isTop: true,
        },
      ],
    });
  }

  private async runGrid(
    jobId: string,
    symbol: string,
    startTime: Date,
    endTime: Date,
    dto: CreateBacktestDto,
    fee: FeeConfig,
    slippage: SlippageConfig,
    sampleCfg: {
      enabled: boolean;
      mode: 'ratio' | 'date';
      inSampleRatio?: number;
      splitAt?: string;
    },
  ): Promise<void> {
    const baseParams = this.toStrategyParams(dto);
    const combinations = this.gridSearch.buildCombinations(dto.grid || {}, {
      quantityType: baseParams.quantityType,
      maxPositions: baseParams.maxPositions,
      defaults: baseParams,
    });

    const intervals = [...new Set(combinations.map((c) => c.cycleInterval))];
    const sortBy = (dto.sortBy || 'totalPnl') as GridSortBy;
    const topN = dto.topN ?? DEFAULT_GRID_TOP_N;
    const initialBalance = this.resolveInitialBalance(dto);

    if (!sampleCfg.enabled) {
      // 全区间网格（界面需提示过拟合风险）
      const klinesByInterval = await this.fetchKlinesByIntervals(
        symbol,
        intervals,
        startTime,
        endTime,
      );
      const gridResults = this.gridSearch.runGrid({
        symbol,
        combinations,
        klinesByInterval,
        fee,
        slippage,
        initialBalance,
        sortBy,
        topN,
      });

      await this.prisma.backtestResult.createMany({
        data: gridResults.map((r) => ({
          jobId,
          sampleType: BacktestSampleType.FULL,
          params: r.params as object,
          stats: r.stats as object,
          trades: r.isTop && r.trades ? (r.trades as object) : Prisma.JsonNull,
          curve: r.isTop && r.equityCurve ? (r.equityCurve as object) : Prisma.JsonNull,
          rank: r.rank,
          isTop: r.isTop,
        })),
      });
      return;
    }

    // 样本内网格 → Top N 参数在样本外复跑
    const windows = splitSampleRange(startTime, endTime, sampleCfg);
    const isKlinesByInterval = await this.fetchKlinesByIntervals(
      symbol,
      intervals,
      windows.inSampleStart,
      windows.inSampleEnd,
    );

    const gridResults = this.gridSearch.runGrid({
      symbol,
      combinations,
      klinesByInterval: isKlinesByInterval,
      fee,
      slippage,
      initialBalance,
      sortBy,
      topN,
    });

    // 保存全部样本内结果（Top 亦带明细与曲线）
    await this.prisma.backtestResult.createMany({
      data: gridResults.map((r) => ({
        jobId,
        sampleType: BacktestSampleType.IN_SAMPLE,
        params: r.params as object,
        stats: r.stats as object,
        trades: r.isTop && r.trades ? (r.trades as object) : Prisma.JsonNull,
        curve: r.isTop && r.equityCurve ? (r.equityCurve as object) : Prisma.JsonNull,
        rank: r.rank,
        isTop: r.isTop,
      })),
    });

    // Top N 在样本外复跑（含成交明细与净值曲线）
    const topParams = gridResults.filter((r) => r.isTop).map((r) => r.params);
    const oosIntervals = [...new Set(topParams.map((p) => p.cycleInterval))];
    const oosKlinesByInterval = await this.fetchKlinesByIntervals(
      symbol,
      oosIntervals,
      windows.outSampleStart,
      windows.outSampleEnd,
    );

    for (let i = 0; i < topParams.length; i++) {
      const params = topParams[i];
      const klines = oosKlinesByInterval.get(params.cycleInterval) || [];
      const filtered = filterKlinesByRange(
        klines,
        windows.outSampleStart,
        windows.outSampleEnd,
        true,
      );
      const output = this.engine.run({
        symbol,
        params,
        fee,
        slippage,
        initialBalance,
        klines: filtered,
      });
      await this.prisma.backtestResult.create({
        data: {
          jobId,
          sampleType: BacktestSampleType.OUT_OF_SAMPLE,
          params: params as object,
          stats: output.stats as object,
          trades: output.trades as object,
          curve: output.equityCurve as object,
          rank: i + 1,
          isTop: true,
        },
      });
    }
  }

  private async fetchKlinesByIntervals(
    symbol: string,
    intervals: string[],
    start: Date,
    end: Date,
  ): Promise<Map<string, KlineInfo[]>> {
    const map = new Map<string, KlineInfo[]>();
    for (const interval of intervals) {
      const klines = await this.klineFetcher.fetchRange(symbol, interval, start, end);
      map.set(interval, klines);
    }
    return map;
  }

  private toStrategyParams(dto: CreateBacktestDto): BacktestStrategyParams {
    return {
      cycleInterval: dto.params.cycleInterval,
      quantity: dto.params.quantity,
      quantityType: dto.params.quantityType as 'BY_QUANTITY' | 'BY_NOTIONAL',
      leverage: dto.params.leverage,
      takeProfitPct: dto.params.takeProfitPct,
      stopLossPct: dto.params.stopLossPct,
      maxPositions: dto.params.maxPositions ?? 10,
    };
  }

  private resolveFee(dto: CreateBacktestDto): FeeConfig {
    return {
      enabled: dto.fee?.enabled ?? true,
      openFeeRate: dto.fee?.openFeeRate ?? DEFAULT_OPEN_FEE_RATE,
      closeFeeRate: dto.fee?.closeFeeRate ?? DEFAULT_CLOSE_FEE_RATE,
    };
  }

  private resolveSlippage(dto: CreateBacktestDto): SlippageConfig {
    return {
      enabled: dto.slippage?.enabled ?? true,
      pct: dto.slippage?.pct ?? DEFAULT_SLIPPAGE_PCT,
      fixedPoints: dto.slippage?.fixedPoints,
    };
  }

  private resolveInitialBalance(dto: CreateBacktestDto): number {
    const v = dto.initialBalance;
    if (v === undefined || v === null || Number.isNaN(Number(v)) || Number(v) < 0) {
      return DEFAULT_INITIAL_BALANCE;
    }
    return Number(v);
  }

  private validateDto(dto: CreateBacktestDto): void {
    const start = new Date(dto.startTime).getTime();
    const end = new Date(dto.endTime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      throw new BadRequestException('无效的时间区间');
    }

    if (dto.type === BacktestJobType.GRID) {
      const g = dto.grid;
      if (!g) {
        throw new BadRequestException('网格搜索必须提供 grid 候选列表');
      }
      const dims = [
        g.cycleInterval,
        g.takeProfitPct,
        g.stopLossPct,
        g.leverage,
        g.quantity,
      ].filter((arr) => arr && arr.length > 0);
      const hasMulti = dims.some((arr) => (arr?.length || 0) >= 2);
      if (!hasMulti) {
        throw new BadRequestException(
          '网格搜索至少需要一个维度提供 ≥2 个候选值（例如 TP% × SL%）',
        );
      }
    }
  }
}
