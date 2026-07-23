/**
 * 参数网格搜索调度
 * 穷举候选组合，在样本内批量回测，按指定目标排序输出 Top N
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MAX_GRID_COMBINATIONS, type GridSortBy } from './backtest.constants';
import { BacktestEngineService } from './backtest-engine.service';
import type { FeeConfig } from './fee-calculator';
import type { SlippageConfig } from './slippage-calculator';
import type {
  BacktestEngineOutput,
  BacktestStats,
  BacktestStrategyParams,
} from './backtest.types';
import type { KlineInfo } from '../exchange/exchange.service';

/** 网格可搜索字段的候选列表 */
export interface GridParamLists {
  cycleInterval?: string[];
  takeProfitPct?: number[];
  stopLossPct?: number[];
  leverage?: number[];
  quantity?: number[];
}

export interface GridSearchBaseParams {
  quantityType: 'BY_QUANTITY' | 'BY_NOTIONAL';
  maxPositions: number;
  /** 未被网格覆盖时的默认值 */
  defaults: Partial<BacktestStrategyParams> & {
    cycleInterval: string;
    takeProfitPct: number;
    stopLossPct: number;
    leverage: number;
    quantity: number;
  };
}

export interface GridCombinationResult {
  params: BacktestStrategyParams;
  stats: BacktestStats;
  /** Top N 保留成交明细，供前端盈亏曲线使用 */
  trades?: BacktestEngineOutput['trades'];
  /** Top N 净值曲线（含盯市） */
  equityCurve?: BacktestEngineOutput['equityCurve'];
  rank: number;
  isTop: boolean;
}

@Injectable()
export class GridSearchService {
  private readonly logger = new Logger(GridSearchService.name);

  constructor(private readonly engine: BacktestEngineService) {}

  /**
   * 生成笛卡尔积组合，超限抛错
   */
  buildCombinations(
    lists: GridParamLists,
    base: GridSearchBaseParams,
  ): BacktestStrategyParams[] {
    const cycleIntervals = lists.cycleInterval?.length
      ? lists.cycleInterval
      : [base.defaults.cycleInterval];
    const takeProfitPcts = lists.takeProfitPct?.length
      ? lists.takeProfitPct
      : [base.defaults.takeProfitPct];
    const stopLossPcts = lists.stopLossPct?.length
      ? lists.stopLossPct
      : [base.defaults.stopLossPct];
    const leverages = lists.leverage?.length ? lists.leverage : [base.defaults.leverage];
    const quantities = lists.quantity?.length ? lists.quantity : [base.defaults.quantity];

    const total =
      cycleIntervals.length *
      takeProfitPcts.length *
      stopLossPcts.length *
      leverages.length *
      quantities.length;

    if (total > MAX_GRID_COMBINATIONS) {
      throw new BadRequestException(
        `网格组合数 ${total} 超过上限 ${MAX_GRID_COMBINATIONS}，请减少候选值`,
      );
    }
    if (total < 1) {
      throw new BadRequestException('网格组合为空');
    }

    const combos: BacktestStrategyParams[] = [];
    for (const cycleInterval of cycleIntervals) {
      for (const takeProfitPct of takeProfitPcts) {
        for (const stopLossPct of stopLossPcts) {
          for (const leverage of leverages) {
            for (const quantity of quantities) {
              combos.push({
                cycleInterval,
                takeProfitPct,
                stopLossPct,
                leverage,
                quantity,
                quantityType: base.quantityType,
                maxPositions: base.maxPositions,
              });
            }
          }
        }
      }
    }
    return combos;
  }

  /**
   * 在给定 K 线上批量回测并排序
   * 注意：若组合含多种 cycleInterval，调用方应按 interval 分组传入对应 K 线
   */
  runGrid(options: {
    symbol: string;
    combinations: BacktestStrategyParams[];
    klinesByInterval: Map<string, KlineInfo[]>;
    fee: FeeConfig;
    slippage: SlippageConfig;
    initialBalance: number;
    sortBy: GridSortBy;
    topN: number;
  }): GridCombinationResult[] {
    const {
      symbol,
      combinations,
      klinesByInterval,
      fee,
      slippage,
      initialBalance,
      sortBy,
      topN,
    } = options;
    const raw: Array<{ params: BacktestStrategyParams; output: BacktestEngineOutput }> = [];

    for (const params of combinations) {
      const klines = klinesByInterval.get(params.cycleInterval) || [];
      const output = this.engine.run({
        symbol,
        params,
        fee,
        slippage,
        initialBalance,
        klines,
      });
      raw.push({ params, output });
    }

    const sorted = [...raw].sort((a, b) =>
      this.compareStats(a.output.stats, b.output.stats, sortBy),
    );

    const n = Math.max(1, Math.min(topN, sorted.length));
    this.logger.log(`Grid search: ${combinations.length} combos, topN=${n}, sortBy=${sortBy}`);

    return sorted.map((item, index) => ({
      params: item.params,
      stats: item.output.stats,
      // 仅 Top N 附带明细与净值曲线，避免网格全量结果撑爆 JSON
      trades: index < n ? item.output.trades : undefined,
      equityCurve: index < n ? item.output.equityCurve : undefined,
      rank: index + 1,
      isTop: index < n,
    }));
  }

  private compareStats(a: BacktestStats, b: BacktestStats, sortBy: GridSortBy): number {
    // maxDrawdown 越小越好；其余默认越大越好
    if (sortBy === 'maxDrawdown') {
      return a.maxDrawdown - b.maxDrawdown;
    }
    const av = a[sortBy] as number;
    const bv = b[sortBy] as number;
    return bv - av;
  }
}
