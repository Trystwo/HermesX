import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { MarketService } from '../market/market.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { PositionSide, PositionStatus, OrderStatus } from '../../common/constants/enums';
import type { Position } from '@prisma/client';

/**
 * TP/SL 监控服务(方案 B: 本地价格监控备用)
 *
 * 主要依赖交易所原生条件单(TAKE_PROFIT_MARKET / STOP_MARKET),
 * 本服务作为备用: 当交易所条件单未触发或需要同步状态时介入。
 *
 * - 每 3 秒检查 OPEN 仓位的 TP/SL 是否应触发
 * - 同步交易所订单状态
 * - 广播仓位状态更新
 */
@Injectable()
export class TpslMonitorService implements OnModuleInit {
  private readonly logger = new Logger(TpslMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly marketService: MarketService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('TP/SL monitor initialized');
    // 订阅所有 OPEN 仓位的 symbol
    setTimeout(() => this.subscribeOpenPositions().catch((e) => {
      this.logger.error(`Subscribe open positions failed: ${e.message}`);
    }), 5000);
  }

  /**
   * 订阅所有 OPEN 仓位的行情
   */
  private async subscribeOpenPositions(): Promise<void> {
    const positions = await this.prisma.position.findMany({
      where: { status: PositionStatus.OPEN },
      include: { strategy: true },
    });
    const symbols = new Set(positions.map((p) => p.strategy.symbol));
    for (const symbol of symbols) {
      this.marketService.subscribe(symbol);
    }
    if (symbols.size > 0) {
      this.logger.log(`Subscribed ${symbols.size} symbols for TP/SL monitoring`);
    }
  }

  /**
   * 每 3 秒检查一次 TP/SL 触发情况
   */
  @Cron('*/3 * * * * *')
  private async monitorTpsl(): Promise<void> {
    try {
      const positions = await this.prisma.position.findMany({
        where: { status: PositionStatus.OPEN },
        include: { strategy: true },
      });

      if (positions.length === 0) return;

      for (const position of positions) {
        await this.checkPosition(position);
      }
    } catch (e) {
      this.logger.error(`TP/SL monitor error: ${(e as Error).message}`);
    }
  }

  /**
   * 检查单个仓位
   */
  private async checkPosition(position: Position & { strategy: any }): Promise<void> {
    try {
      let currentPrice: number;
      try {
        currentPrice = await this.marketService.getPrice(position.strategy.symbol);
      } catch {
        return; // 价格获取失败,跳过
      }

      const isLong = position.side === PositionSide.LONG;
      let triggerType: 'TP' | 'SL' | null = null;

      // 检查止盈
      if (position.takeProfitPrice) {
        const hit = isLong
          ? currentPrice >= position.takeProfitPrice
          : currentPrice <= position.takeProfitPrice;
        if (hit) triggerType = 'TP';
      }

      // 检查止损
      if (!triggerType && position.stopLossPrice) {
        const hit = isLong
          ? currentPrice <= position.stopLossPrice
          : currentPrice >= position.stopLossPrice;
        if (hit) triggerType = 'SL';
      }

      if (triggerType) {
        this.logger.log(
          `Local ${triggerType} trigger for position ${position.id}: price=${currentPrice}, tp=${position.takeProfitPrice}, sl=${position.stopLossPrice}`,
        );

        // 检查交易所是否已成交(避免重复平仓)
        const alreadyClosed = await this.checkExchangeOrderFilled(position.id);
        if (alreadyClosed) {
          // 交易所已触发,只需同步状态
          await this.syncPositionStatus(position.id, triggerType);
        } else {
          // 交易所未触发,本地主动平仓
          try {
            await this.orderService.closePosition(
              position.id,
              triggerType === 'TP' ? 'TP_HIT' : 'SL_HIT',
            );
            this.gateway.broadcastOrderFill({
              positionId: position.id,
              type: triggerType,
              price: currentPrice,
              timestamp: Date.now(),
            });
          } catch (e) {
            this.logger.error(
              `Local close failed for ${position.id}: ${(e as Error).message}`,
            );
          }
        }
      }

      // 广播仓位快照
      const unrealizedPnl = this.calculateUnrealizedPnl(position, currentPrice);
      this.gateway.broadcastPnlSnapshot({
        positionId: position.id,
        strategyId: position.strategyId,
        currentPrice,
        unrealizedPnl,
        timestamp: Date.now(),
      });
    } catch (e) {
      this.logger.error(
        `Check position ${position.id} failed: ${(e as Error).message}`,
      );
    }
  }

  /**
   * 检查交易所侧的 TP/SL 订单是否已成交
   */
  private async checkExchangeOrderFilled(positionId: string): Promise<boolean> {
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        positionId,
        status: OrderStatus.PENDING,
      },
    });

    if (pendingOrders.length === 0) {
      // 没有挂单,可能已成交
      return false;
    }

    // 简化: 如果有挂单存在,认为交易所未触发
    // 完整实现需要查询交易所订单状态
    return false;
  }

  /**
   * 同步仓位状态(交易所已触发,数据库未更新)
   */
  private async syncPositionStatus(positionId: string, triggerType: 'TP' | 'SL'): Promise<void> {
    try {
      const position = await this.prisma.position.findUnique({
        where: { id: positionId },
      });
      if (!position || position.status !== PositionStatus.OPEN) return;

      const status = triggerType === 'TP' ? PositionStatus.TP_HIT : PositionStatus.SL_HIT;
      await this.prisma.position.update({
        where: { id: positionId },
        data: {
          status,
          closedAt: new Date(),
        },
      });

      // 取消残留挂单
      await this.orderService.cancelPendingOrders(positionId);

      await this.prisma.tradeLog.create({
        data: {
          positionId,
          action: `${triggerType}_SYNCED`,
          detail: { triggerType, syncedAt: new Date().toISOString() },
        },
      });

      this.logger.log(`Position ${positionId} status synced to ${status}`);
    } catch (e) {
      this.logger.error(`Sync position ${positionId} failed: ${(e as Error).message}`);
    }
  }

  /**
   * 计算未实现盈亏
   */
  private calculateUnrealizedPnl(position: Position, currentPrice: number): number {
    if (position.side === PositionSide.LONG) {
      return (currentPrice - position.entryPrice) * position.quantity;
    } else {
      return (position.entryPrice - currentPrice) * position.quantity;
    }
  }
}
