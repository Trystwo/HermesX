import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExchangeService } from '../exchange/exchange.service';
import { MarketService } from '../market/market.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { PositionStatus, QuantityType, StrategyStatus } from '../../common/constants/enums';
import type { Strategy } from '@prisma/client';

/** 保证金缓冲系数（手续费/滑点） */
const MARGIN_BUFFER = 1.2;
/** 每周期开多+空 */
const HEDGE_LEGS = 2;
/** system_settings 中风控参数的固定 key */
const RISK_PARAMS_KEY = 'risk_params';

interface PersistedRiskParams {
  maxPositions: number;
  maxSingleNotional: number;
  maxTotalLossPct: number;
  maxConsecutiveLosses: number;
}

export interface RiskCheckResult {
  passed: boolean;
  reason?: string;
}

export interface RiskStats {
  totalPnl: number;
  consecutiveLosses: number;
  openPositions: number;
  circuitBreakerTriggered: boolean;
}

/**
 * 风控服务
 * - 建仓前检查: 最大持仓数、可用保证金、单笔金额上限
 * - 运行时监控: 总亏损阈值、连续亏损
 * - 异常熔断: API错误率、行情断连
 */
@Injectable()
export class RiskService implements OnModuleInit {
  private readonly logger = new Logger(RiskService.name);

  // 风控参数（可运行时修改，持久化到 system_settings）
  private maxPositions: number;
  private maxSingleNotional: number;
  private maxTotalLossPct: number;
  private maxConsecutiveLosses: number;

  // 熔断状态
  private circuitBreakerTriggered = false;
  private circuitBreakerReason = '';
  private circuitBreakerTriggeredAt = 0;

  // 连续亏损计数(内存,重启重置)
  private consecutiveLosses = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeService: ExchangeService,
    private readonly marketService: MarketService,
    private readonly configService: ConfigService,
    private readonly gateway: RealtimeGateway,
  ) {
    this.maxPositions = this.configService.get<number>('risk.maxPositions') || 5;
    this.maxSingleNotional = this.configService.get<number>('risk.maxSingleNotional') || 1000;
    this.maxTotalLossPct = this.configService.get<number>('risk.maxTotalLossPct') || 20;
    this.maxConsecutiveLosses = this.configService.get<number>('risk.maxConsecutiveLosses') || 5;
  }

  async onModuleInit(): Promise<void> {
    await this.loadPersistedParams();
  }

  private async loadPersistedParams(): Promise<void> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: RISK_PARAMS_KEY },
      });
      if (!row?.value || typeof row.value !== 'object' || Array.isArray(row.value)) {
        return;
      }
      const saved = row.value as Record<string, unknown>;
      if (typeof saved.maxPositions === 'number') this.maxPositions = saved.maxPositions;
      if (typeof saved.maxSingleNotional === 'number') {
        this.maxSingleNotional = saved.maxSingleNotional;
      }
      if (typeof saved.maxTotalLossPct === 'number') this.maxTotalLossPct = saved.maxTotalLossPct;
      if (typeof saved.maxConsecutiveLosses === 'number') {
        this.maxConsecutiveLosses = saved.maxConsecutiveLosses;
      }
      this.logger.log(`Risk params loaded from DB: ${JSON.stringify(this.getPersistedSnapshot())}`);
    } catch (e) {
      this.logger.warn(`Failed to load persisted risk params: ${(e as Error).message}`);
    }
  }

  private getPersistedSnapshot(): PersistedRiskParams {
    return {
      maxPositions: this.maxPositions,
      maxSingleNotional: this.maxSingleNotional,
      maxTotalLossPct: this.maxTotalLossPct,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
    };
  }

  private async persistParams(): Promise<void> {
    const value = this.getPersistedSnapshot() as unknown as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key: RISK_PARAMS_KEY },
      create: { key: RISK_PARAMS_KEY, value },
      update: { value },
    });
  }

  /**
   * 建仓前检查
   */
  async checkBeforeOpen(strategy: Strategy): Promise<RiskCheckResult> {
    // 1. 熔断检查
    if (this.circuitBreakerTriggered) {
      const elapsed = Date.now() - this.circuitBreakerTriggeredAt;
      // 熔断持续 5 分钟
      if (elapsed < 5 * 60 * 1000) {
        return {
          passed: false,
          reason: `Circuit breaker active: ${this.circuitBreakerReason}`,
        };
      }
      // 解除熔断
      this.circuitBreakerTriggered = false;
      this.logger.warn('Circuit breaker released after cooldown');
    }

    // 2. 最大持仓数检查（取 策略上限 与 全局风控上限 的较小值）
    const openCount = await this.prisma.position.count({
      where: {
        strategyId: strategy.id,
        status: PositionStatus.OPEN,
      },
    });
    const maxAllowed = Math.min(
      strategy.maxPositions || this.maxPositions,
      this.maxPositions,
    );
    if (openCount >= maxAllowed) {
      return {
        passed: false,
        reason: `Max positions reached: ${openCount}/${maxAllowed} (strategy=${strategy.maxPositions}, risk=${this.maxPositions})`,
      };
    }

    // 3. 连续亏损检查
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      return {
        passed: false,
        reason: `Consecutive losses ${this.consecutiveLosses} >= ${this.maxConsecutiveLosses}`,
      };
    }

    // 4. 单笔名义上限（BY_NOTIONAL 不依赖行情）
    if (
      strategy.quantityType === QuantityType.BY_NOTIONAL &&
      strategy.quantity > this.maxSingleNotional
    ) {
      return {
        passed: false,
        reason: `Single notional ${strategy.quantity} exceeds limit ${this.maxSingleNotional}`,
      };
    }

    // 5. 所需保证金 vs 可用余额（取价失败则跳过，不阻塞）
    try {
      let sideNotional: number;
      if (strategy.quantityType === QuantityType.BY_NOTIONAL) {
        sideNotional = strategy.quantity;
      } else {
        const price = await this.marketService.getPrice(strategy.symbol);
        sideNotional = strategy.quantity * price;
        if (sideNotional > this.maxSingleNotional) {
          return {
            passed: false,
            reason: `Single notional ${sideNotional} exceeds limit ${this.maxSingleNotional}`,
          };
        }
      }

      const leverage = strategy.leverage > 0 ? strategy.leverage : 1;
      const cycleNotional = sideNotional * HEDGE_LEGS;
      const requiredMargin = (cycleNotional / leverage) * MARGIN_BUFFER;
      const legMargin = (sideNotional / leverage) * MARGIN_BUFFER;

      const longEx = await this.exchangeService.getAdapterForStrategy(
        strategy.id,
        'LONG',
      );
      const longBal = await this.exchangeService.fetchBalance(longEx, {
        symbol: strategy.symbol,
      });

      // Lighter 双子账户：各账户只需覆盖单腿保证金
      if (!longEx.supportsHedgeMode) {
        const shortEx = await this.exchangeService.getAdapterForStrategy(
          strategy.id,
          'SHORT',
        );
        const shortBal = await this.exchangeService.fetchBalance(shortEx, {
          symbol: strategy.symbol,
        });
        if (longBal.free < legMargin) {
          return {
            passed: false,
            reason:
              `Insufficient LONG-leg margin: free=${longBal.free} ${longBal.currency}, ` +
              `required=${legMargin.toFixed(4)}`,
          };
        }
        if (shortBal.free < legMargin) {
          return {
            passed: false,
            reason:
              `Insufficient SHORT-leg margin: free=${shortBal.free} ${shortBal.currency}, ` +
              `required=${legMargin.toFixed(4)}`,
          };
        }
      } else if (longBal.free < requiredMargin) {
        return {
          passed: false,
          reason:
            `Insufficient margin: free=${longBal.free} ${longBal.currency}, ` +
            `required=${requiredMargin.toFixed(4)} (cycleNotional=${cycleNotional.toFixed(4)}, leverage=${leverage})`,
        };
      }
    } catch (e) {
      this.logger.warn(`Balance/notional check skipped: ${(e as Error).message}`);
    }

    return { passed: true };
  }

  /**
   * 记录仓位结果(用于连续亏损统计)
   */
  recordPositionResult(realizedPnl: number | null): void {
    if (realizedPnl === null) return;
    if (realizedPnl < 0) {
      this.consecutiveLosses++;
      this.logger.warn(`Loss recorded, consecutive losses: ${this.consecutiveLosses}`);
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.triggerCircuitBreaker(
          `Consecutive losses ${this.consecutiveLosses} reached threshold`,
        );
      }
    } else if (realizedPnl > 0) {
      this.consecutiveLosses = 0;
    }
  }

  /**
   * 触发熔断
   */
  triggerCircuitBreaker(reason: string): void {
    this.circuitBreakerTriggered = true;
    this.circuitBreakerReason = reason;
    this.circuitBreakerTriggeredAt = Date.now();
    this.logger.error(`Circuit breaker triggered: ${reason}`);
    this.gateway.broadcastAlert({
      type: 'CIRCUIT_BREAKER',
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * 手动解除熔断（紧急停止后可调用，或冷却结束后自动解除）
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerTriggered = false;
    this.circuitBreakerReason = '';
    this.circuitBreakerTriggeredAt = 0;
    this.consecutiveLosses = 0;
    this.logger.warn('Circuit breaker manually reset');
  }

  /**
   * 获取风控参数
   */
  getParams() {
    return {
      maxPositions: this.maxPositions,
      maxSingleNotional: this.maxSingleNotional,
      maxTotalLossPct: this.maxTotalLossPct,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
      circuitBreakerTriggered: this.circuitBreakerTriggered,
      circuitBreakerReason: this.circuitBreakerReason,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  /**
   * 更新风控参数（内存 + 持久化）
   */
  async updateParams(params: {
    maxPositions?: number;
    maxSingleNotional?: number;
    maxTotalLossPct?: number;
    maxConsecutiveLosses?: number;
  }) {
    if (params.maxPositions !== undefined) this.maxPositions = params.maxPositions;
    if (params.maxSingleNotional !== undefined) this.maxSingleNotional = params.maxSingleNotional;
    if (params.maxTotalLossPct !== undefined) this.maxTotalLossPct = params.maxTotalLossPct;
    if (params.maxConsecutiveLosses !== undefined) this.maxConsecutiveLosses = params.maxConsecutiveLosses;
    await this.persistParams();
    this.logger.log(`Risk params updated: ${JSON.stringify(params)}`);
    return this.getParams();
  }

  /**
   * 获取风控状态
   */
  getStats(): RiskStats {
    return {
      totalPnl: 0, // 由 stats 模块计算
      consecutiveLosses: this.consecutiveLosses,
      openPositions: 0,
      circuitBreakerTriggered: this.circuitBreakerTriggered,
    };
  }

  /**
   * 每 30 秒运行时监控
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  private async runtimeMonitor(): Promise<void> {
    try {
      // 检查总亏损阈值
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await this.prisma.position.aggregate({
        where: {
          closedAt: { gte: today },
          realizedPnl: { not: null },
        },
        _sum: { realizedPnl: true },
      });

      const totalPnl = result._sum.realizedPnl || 0;

      // 假设初始资金为 maxSingleNotional * 10(简化)
      const initialCapital = this.maxSingleNotional * 10;
      const lossPct = (Math.abs(Math.min(0, totalPnl)) / initialCapital) * 100;

      if (lossPct >= this.maxTotalLossPct && !this.circuitBreakerTriggered) {
        this.triggerCircuitBreaker(
          `Total loss ${lossPct.toFixed(2)}% exceeds threshold ${this.maxTotalLossPct}%`,
        );
      }

      // 监控异常策略(ERROR 状态)
      const errorStrategies = await this.prisma.strategy.findMany({
        where: { status: StrategyStatus.ERROR, isActive: true },
      });
      if (errorStrategies.length > 0) {
        this.logger.warn(
          `Detected ${errorStrategies.length} strategies in ERROR state`,
        );
      }
    } catch (e) {
      this.logger.error(`Runtime monitor failed: ${(e as Error).message}`);
    }
  }
}
