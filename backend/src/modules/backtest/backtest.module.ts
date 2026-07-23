/**
 * 回测模块
 * 文件职责：
 * - backtest-engine.service.ts     回测引擎（周期双边开仓 + 精确 Q 的 TP/SL）
 * - fee-calculator.ts              手续费计算器
 * - slippage-calculator.ts         滑点计算器
 * - grid-search.service.ts         参数网格搜索调度
 * - sample-split.ts                样本切分与过滤
 * - kline-fetcher.service.ts       历史行情拉取/缓存（公开行情，无下单）
 * - backtest.service.ts            任务编排与持久化
 * - backtest.controller.ts         REST API
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BacktestController } from './backtest.controller';
import { BacktestEngineService } from './backtest-engine.service';
import { BacktestService } from './backtest.service';
import { GridSearchService } from './grid-search.service';
import { KlineFetcherService } from './kline-fetcher.service';

@Module({
  imports: [PrismaModule],
  controllers: [BacktestController],
  providers: [
    BacktestService,
    BacktestEngineService,
    GridSearchService,
    KlineFetcherService,
  ],
  exports: [BacktestService],
})
export class BacktestModule {}
