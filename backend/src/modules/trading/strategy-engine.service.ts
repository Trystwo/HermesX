import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { RiskService } from '../risk/risk.service';
import { MarketService } from '../market/market.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import {
  PositionSide,
  PositionStatus,
  QuantityType,
  StrategyStatus,
} from '../../common/constants/enums';
import { cycleIntervalToCron, generateCycleId } from './cycle.util';
import type { Strategy } from '@prisma/client';

/**
 * 策略引擎
 * - 基于 @nestjs/schedule 动态注册 CronJob
 * - 每个策略按 cycleInterval 触发
 * - 状态机: IDLE → ARMED → OPENING → MONITORING → CLOSING → DONE
 *
 * 每周期:
 *   1. 检查风控
 *   2. 获取价格
 *   3. 开多 + 空对冲仓位
 *   4. 挂 TP/SL 条件单
 */
@Injectable()
export class StrategyEngineService implements OnModuleInit {
  private readonly logger = new Logger(StrategyEngineService.name);
  private readonly jobPrefix = 'strategy_';

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly riskService: RiskService,
    private readonly marketService: MarketService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // 延迟 3 秒启动,等待其他服务初始化
    setTimeout(() => {
      this.loadActiveStrategies().catch((e) =>
        this.logger.error(`Failed to load active strategies: ${e.message}`),
      );
    }, 3000);
  }

  /**
   * 加载所有活跃策略并注册 cron
   */
  async loadActiveStrategies(): Promise<void> {
    // 兼容历史数据：UI 只写了 status=RUNNING 但未置 isActive 的策略
    const strategies = await this.prisma.strategy.findMany({
      where: {
        OR: [
          { isActive: true },
          { status: { in: [StrategyStatus.RUNNING, StrategyStatus.ARMED, StrategyStatus.MONITORING, StrategyStatus.OPENING] } },
        ],
      },
    });

    for (const strategy of strategies) {
      if (!strategy.isActive) {
        await this.prisma.strategy.update({
          where: { id: strategy.id },
          data: { isActive: true, status: StrategyStatus.RUNNING },
        });
        strategy.isActive = true;
        strategy.status = StrategyStatus.RUNNING;
      }
      this.registerStrategyCron(strategy);
    }

    this.logger.log(`Loaded ${strategies.length} active strategies`);
  }

  /**
   * 注册策略的 cron 任务
   */
  registerStrategyCron(strategy: Strategy): void {
    const jobName = `${this.jobPrefix}${strategy.id}`;

    // 已存在则先销毁
    this.unregisterStrategyCron(strategy.id);

    try {
      const cronExpression = cycleIntervalToCron(strategy.cycleInterval);
      const job = new CronJob(cronExpression, async () => {
        await this.executeCycle(strategy.id);
      });

      this.schedulerRegistry.addCronJob(jobName, job as any);
      job.start();

      this.logger.log(
        `Registered cron for strategy ${strategy.name} (${strategy.cycleInterval} → ${cronExpression})`,
      );

      // 前端以 RUNNING 表示运行中
      this.updateStrategyStatus(strategy.id, StrategyStatus.RUNNING);
    } catch (e) {
      this.logger.error(
        `Failed to register cron for strategy ${strategy.id}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 注销策略的 cron 任务
   */
  unregisterStrategyCron(strategyId: string): void {
    const jobName = `${this.jobPrefix}${strategyId}`;
    try {
      const existing = this.schedulerRegistry.getCronJob(jobName);
      existing.stop();
      this.schedulerRegistry.deleteCronJob(jobName);
      this.logger.log(`Unregistered cron for strategy ${strategyId}`);
    } catch {
      // 不存在,忽略
    }
  }

  /**
   * 执行单个周期
   */
  private async executeCycle(strategyId: string): Promise<void> {
    let strategy: Strategy | null = null;
    try {
      strategy = await this.prisma.strategy.findUnique({
        where: { id: strategyId },
      });
      if (!strategy || !strategy.isActive) {
        this.logger.warn(`Strategy ${strategyId} not found or inactive, skipping`);
        return;
      }

      const cycleId = generateCycleId(strategy.cycleInterval);
      this.logger.log(`Executing cycle ${cycleId} for strategy ${strategy.name}`);

      // 状态机: RUNNING → OPENING → MONITORING（UI 侧 OPENING/MONITORING 仍视为运行中）
      await this.updateStrategyStatus(strategy.id, StrategyStatus.OPENING);

      // 1. 风控检查
      const riskCheck = await this.riskService.checkBeforeOpen(strategy);
      if (!riskCheck.passed) {
        this.logger.warn(`Risk check failed for ${strategy.name}: ${riskCheck.reason}`);
        this.gateway.broadcastAlert({
          type: 'RISK_BLOCK',
          strategyId: strategy.id,
          reason: riskCheck.reason || 'unknown',
          timestamp: Date.now(),
        });
        // 保持运行中，等待下一周期重试
        await this.updateStrategyStatus(strategy.id, StrategyStatus.RUNNING);
        return;
      }

      // 2. 获取当前价格
      const currentPrice = await this.marketService.getPrice(strategy.symbol);

      // 3. 计算数量
      const quantity = await this.calculateQuantity(strategy, currentPrice);
      if (quantity <= 0) {
        this.logger.warn(
          `Calculated quantity is 0 for ${strategy.name} (price=${currentPrice}, qtyCfg=${strategy.quantity} ${strategy.quantityType}). Increase notional or switch to BY_QUANTITY.`,
        );
        this.gateway.broadcastAlert({
          type: 'QTY_ZERO',
          strategyId: strategy.id,
          reason: `名义金额过小，折算数量为 0（价格 ${currentPrice}）。请增大单量或改用数量模式。`,
          timestamp: Date.now(),
        });
        await this.updateStrategyStatus(strategy.id, StrategyStatus.RUNNING);
        return;
      }

      // 4. 开多仓
      const longPosition = await this.orderService.openPosition(
        strategy,
        PositionSide.LONG,
        quantity,
      );
      this.gateway.broadcastPositionUpdate({
        type: 'POSITION_OPENED',
        position: longPosition as any,
      });

      // 5. 开空仓
      const shortPosition = await this.orderService.openPosition(
        strategy,
        PositionSide.SHORT,
        quantity,
      );
      this.gateway.broadcastPositionUpdate({
        type: 'POSITION_OPENED',
        position: shortPosition as any,
      });

      // 6. 挂 TP/SL
      await this.orderService.placeTpSl(longPosition);
      await this.orderService.placeTpSl(shortPosition);

      // 回到 RUNNING，便于前端状态展示；仓位侧由 position 列表体现持仓
      await this.updateStrategyStatus(strategy.id, StrategyStatus.RUNNING);

      this.gateway.broadcastStrategyStatus({
        strategyId: strategy.id,
        status: StrategyStatus.RUNNING,
        cycleId,
      });

      this.logger.log(
        `Cycle ${cycleId} completed: LONG=${longPosition.id} SHORT=${shortPosition.id}`,
      );
    } catch (e) {
      const err = e as Error;
      this.logger.error(
        `Cycle execution failed for strategy ${strategyId}: ${err.message}`,
        err.stack,
      );
      if (strategy) {
        await this.updateStrategyStatus(strategy.id, StrategyStatus.ERROR);
      }
      this.gateway.broadcastAlert({
        type: 'CYCLE_ERROR',
        strategyId,
        reason: err.message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 计算下单数量
   */
  private async calculateQuantity(strategy: Strategy, price: number): Promise<number> {
    if (strategy.quantityType === QuantityType.BY_QUANTITY) {
      return strategy.quantity;
    }

    // BY_NOTIONAL: 按名义价值计算数量
    if (price <= 0) return 0;
    const qty = strategy.quantity / price;
    // BTC 等高精度标的：3 位小数会把小额名义金额抹成 0（如 $10/BTC≈0.0001）
    // 先保留 6 位；实际下单仍受交易所最小数量限制
    const rounded = Math.floor(qty * 1_000_000) / 1_000_000;
    return rounded > 0 ? rounded : 0;
  }

  /**
   * 更新策略状态并广播
   */
  private async updateStrategyStatus(strategyId: string, status: StrategyStatus): Promise<void> {
    try {
      await this.prisma.strategy.update({
        where: { id: strategyId },
        data: { status },
      });
      this.gateway.broadcastStrategyStatus({
        strategyId,
        status,
        timestamp: Date.now(),
      });
    } catch (e) {
      this.logger.error(`Failed to update strategy status: ${(e as Error).message}`);
    }
  }

  /**
   * 每分钟检查是否需要清理 DONE 状态的策略
   */
  @Cron('0 * * * *')
  private async cleanupStrategies(): Promise<void> {
    try {
      // 将 ERROR 状态的活跃策略重置为 RUNNING（自动恢复，等待下一周期）
      await this.prisma.strategy.updateMany({
        where: { status: StrategyStatus.ERROR, isActive: true },
        data: { status: StrategyStatus.RUNNING },
      });
    } catch (e) {
      this.logger.error(`Cleanup failed: ${(e as Error).message}`);
    }
  }
}
