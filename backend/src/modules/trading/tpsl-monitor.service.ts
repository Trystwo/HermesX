import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderService } from '../order/order.service';
import {
  ExchangeService,
  type OpenOrderInfo,
} from '../exchange/exchange.service';
import { MarketService } from '../market/market.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import {
  PositionSide,
  PositionStatus,
  OrderStatus,
  OrderType,
} from '../../common/constants/enums';
import type { Order, Position, Strategy } from '@prisma/client';

/**
 * TP/SL 监控服务
 *
 * 同步策略（避免逐单 fetchOrder 触发币安限频）:
 * 1. 按 strategy/symbol 批量 fetchOpenOrders（含挂单时间 timestamp）
 * 2. 本地 PENDING 条件单若不在交易所挂单列表 → 视为已成交/消失
 * 3. 一侧消失、对侧仍挂着 → 同步仓位并取消对侧残留单
 * 4. 本地价格触发仅作 backup（localAutoCloseEnabled=true）
 */
@Injectable()
export class TpslMonitorService implements OnModuleInit {
  private readonly logger = new Logger(TpslMonitorService.name);
  /** 限频后暂停同步至该时间戳 */
  private rateLimitedUntil = 0;
  private syncRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly exchangeService: ExchangeService,
    private readonly marketService: MarketService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('TP/SL monitor initialized');
    setTimeout(() => this.subscribeOpenPositions().catch((e) => {
      this.logger.error(`Subscribe open positions failed: ${e.message}`);
    }), 5000);
  }

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
   * 每 10 秒：用交易所挂单列表对账（低频，避免 -1003）
   */
  @Cron('*/10 * * * * *')
  private async syncExchangeFills(): Promise<void> {
    if (this.syncRunning) return;
    if (Date.now() < this.rateLimitedUntil) return;

    this.syncRunning = true;
    try {
      const positions = await this.prisma.position.findMany({
        where: { status: PositionStatus.OPEN },
        include: { strategy: true, orders: true },
      });
      if (positions.length === 0) return;

      // 按 strategyId 分组，每个策略只拉一次 openOrders
      const byStrategy = new Map<string, typeof positions>();
      for (const p of positions) {
        const list = byStrategy.get(p.strategyId) ?? [];
        list.push(p);
        byStrategy.set(p.strategyId, list);
      }

      for (const [strategyId, group] of byStrategy) {
        await this.syncStrategyGroup(strategyId, group);
      }
    } catch (e) {
      this.handleRateLimitError(e as Error);
      this.logger.error(`TP/SL exchange sync error: ${(e as Error).message}`);
    } finally {
      this.syncRunning = false;
    }
  }

  /**
   * 每 3 秒：本地价格监控 + PnL 广播（不打私有 REST）
   */
  @Cron('*/3 * * * * *')
  private async monitorLocalPrice(): Promise<void> {
    try {
      const positions = await this.prisma.position.findMany({
        where: { status: PositionStatus.OPEN },
        include: { strategy: true },
      });
      if (positions.length === 0) return;

      for (const position of positions) {
        await this.checkLocalPrice(position);
      }
    } catch (e) {
      this.logger.error(`TP/SL local monitor error: ${(e as Error).message}`);
    }
  }

  private async syncStrategyGroup(
    strategyId: string,
    positions: Array<Position & { strategy: Strategy; orders: Order[] }>,
  ): Promise<void> {
    if (Date.now() < this.rateLimitedUntil) return;

    const symbol = positions[0].strategy.symbol;
    let exchange;
    try {
      exchange = await this.exchangeService.getExchangeForStrategy(strategyId);
    } catch (e) {
      this.logger.warn(
        `Cannot get exchange for strategy ${strategyId}: ${(e as Error).message}`,
      );
      return;
    }

    let openOrders: OpenOrderInfo[];
    try {
      openOrders = await this.exchangeService.fetchOpenOrders(exchange, symbol);
    } catch (e) {
      this.handleRateLimitError(e as Error);
      this.logger.warn(
        `fetchOpenOrders ${symbol} failed: ${(e as Error).message}`,
      );
      return;
    }

    const openIds = new Set(openOrders.map((o) => o.id).filter(Boolean));

    // 挂单明细仅 debug；有 TP/SL 不对称时下面会 LOG
    if (openOrders.length > 0) {
      this.logger.debug(
        `Open conditional orders ${symbol}: ${openOrders.length}`,
      );
    }

    for (const position of positions) {
      try {
        const synced = await this.reconcilePositionAgainstOpenOrders(
          position,
          openIds,
          openOrders,
          exchange,
        );
        if (synced) {
          // 同步后挂单列表可能变化，刷新本策略后续比对
          try {
            openOrders = await this.exchangeService.fetchOpenOrders(
              exchange,
              symbol,
            );
            openIds.clear();
            for (const o of openOrders) {
              if (o.id) openIds.add(o.id);
            }
          } catch (e) {
            this.handleRateLimitError(e as Error);
            break;
          }
        }
      } catch (e) {
        this.handleRateLimitError(e as Error);
        this.logger.error(
          `Reconcile position ${position.id} failed: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * 用交易所当前挂单集合判断本地 PENDING TP/SL 是否已消失（成交）
   */
  private async reconcilePositionAgainstOpenOrders(
    position: Position & { strategy: Strategy; orders: Order[] },
    openIds: Set<string>,
    openOrders: OpenOrderInfo[],
    exchange: Awaited<ReturnType<ExchangeService['getExchangeForStrategy']>>,
  ): Promise<boolean> {
    const pendingTp = this.latestPending(
      position.orders,
      OrderType.TAKE_PROFIT_MARKET,
    );
    const pendingSl = this.latestPending(
      position.orders,
      OrderType.STOP_MARKET,
    );

    if (!pendingTp && !pendingSl) {
      return false;
    }

    const tpAlive = !!(pendingTp?.exchangeOrderId && openIds.has(pendingTp.exchangeOrderId));
    const slAlive = !!(pendingSl?.exchangeOrderId && openIds.has(pendingSl.exchangeOrderId));
    const tpGone = !!(pendingTp?.exchangeOrderId && !tpAlive);
    const slGone = !!(pendingSl?.exchangeOrderId && !slAlive);

    // 对侧仍挂着时，消失的一侧即为成交
    if (tpGone && slAlive) {
      const slEx = openOrders.find((o) => o.id === pendingSl!.exchangeOrderId);
      this.logger.log(
        `TP gone, SL still open for ${position.id}: slId=${pendingSl!.exchangeOrderId} slPlacedAt=${
          slEx?.datetime ?? (slEx?.timestamp ? new Date(slEx.timestamp).toISOString() : '?')
        }`,
      );
      return this.applyFillSync(position, 'TP', pendingTp!);
    }

    if (slGone && tpAlive) {
      const tpEx = openOrders.find((o) => o.id === pendingTp!.exchangeOrderId);
      this.logger.log(
        `SL gone, TP still open for ${position.id}: tpId=${pendingTp!.exchangeOrderId} tpPlacedAt=${
          tpEx?.datetime ?? (tpEx?.timestamp ? new Date(tpEx.timestamp).toISOString() : '?')
        }`,
      );
      return this.applyFillSync(position, 'SL', pendingSl!);
    }

    // 两侧都消失：核对交易所仓位，推断 TP/SL
    if (tpGone && slGone) {
      return this.syncIfExchangePositionFlat(position, exchange, pendingTp, pendingSl);
    }

    // 仅一侧本地有单且已消失
    if (tpGone && !pendingSl) {
      return this.applyFillSync(position, 'TP', pendingTp!);
    }
    if (slGone && !pendingTp) {
      return this.applyFillSync(position, 'SL', pendingSl!);
    }

    return false;
  }

  private async applyFillSync(
    position: Position & { strategy: Strategy },
    triggerType: 'TP' | 'SL',
    filledOrder: Order,
  ): Promise<boolean> {
    const updated = await this.orderService.syncClosedByConditionalFill(
      position.id,
      triggerType,
      {
        filledOrderId: filledOrder.id,
        fillPrice:
          filledOrder.price ??
          (triggerType === 'TP'
            ? position.takeProfitPrice ?? undefined
            : position.stopLossPrice ?? undefined),
        filledQty: position.quantity,
      },
    );
    if (!updated) return false;

    this.gateway.broadcastOrderFill({
      positionId: position.id,
      type: triggerType,
      price:
        updated.takeProfitPrice ??
        updated.stopLossPrice ??
        updated.entryPrice,
      timestamp: Date.now(),
    });
    return true;
  }

  private latestPending(orders: Order[], type: string): Order | undefined {
    const matched = orders.filter(
      (o) => o.type === type && o.status === OrderStatus.PENDING && o.exchangeOrderId,
    );
    if (matched.length === 0) return undefined;
    return matched.reduce((a, b) =>
      a.createdAt.getTime() >= b.createdAt.getTime() ? a : b,
    );
  }

  private async checkLocalPrice(
    position: Position & { strategy: Strategy },
  ): Promise<void> {
    try {
      let currentPrice: number;
      try {
        currentPrice = await this.marketService.getPrice(position.strategy.symbol);
      } catch {
        return;
      }

      const isLong = position.side === PositionSide.LONG;
      let triggerType: 'TP' | 'SL' | null = null;

      if (position.takeProfitPrice) {
        const hit = isLong
          ? currentPrice >= position.takeProfitPrice
          : currentPrice <= position.takeProfitPrice;
        if (hit) triggerType = 'TP';
      }

      if (!triggerType && position.stopLossPrice) {
        const hit = isLong
          ? currentPrice <= position.stopLossPrice
          : currentPrice >= position.stopLossPrice;
        if (hit) triggerType = 'SL';
      }

      if (triggerType && position.strategy.localAutoCloseEnabled) {
        this.logger.log(
          `Local ${triggerType} auto-close for ${position.id}: price=${currentPrice}`,
        );
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
        `Check local price ${position.id} failed: ${(e as Error).message}`,
      );
    }
  }

  private async syncIfExchangePositionFlat(
    position: Position & { strategy: Strategy },
    exchange: Awaited<ReturnType<ExchangeService['getExchangeForStrategy']>>,
    pendingTp?: Order,
    pendingSl?: Order,
  ): Promise<boolean> {
    try {
      const positions = await this.exchangeService.fetchPositions(exchange, [
        position.strategy.symbol,
      ]);
      const normalized = position.strategy.symbol
        .replace(/[:/]/g, '')
        .toUpperCase();
      const targetSide = position.side.toUpperCase();
      const match = positions.find((p) => {
        const pSym = (p.symbol || '').replace(/[:/]/g, '').toUpperCase();
        const symOk =
          pSym === normalized ||
          pSym.includes(normalized) ||
          normalized.includes(pSym.replace('USDTUSDT', 'USDT'));
        return symOk && p.side === targetSide;
      });
      const contracts = match?.contracts ?? 0;
      if (contracts + 1e-12 >= position.quantity) {
        return false;
      }

      let triggerType: 'TP' | 'SL' = 'TP';
      try {
        const price = await this.marketService.getPrice(position.strategy.symbol);
        const tp = position.takeProfitPrice;
        const sl = position.stopLossPrice;
        if (tp != null && sl != null) {
          triggerType =
            Math.abs(price - tp) <= Math.abs(price - sl) ? 'TP' : 'SL';
        } else if (sl != null && tp == null) {
          triggerType = 'SL';
        }
      } catch {
        // default TP
      }

      this.logger.warn(
        `Both TP/SL gone & exchange flat for ${position.id} (${position.side} contracts=${contracts}), syncing as ${triggerType}`,
      );

      const filledOrder =
        triggerType === 'TP' ? pendingTp : pendingSl;
      if (filledOrder) {
        return this.applyFillSync(position, triggerType, filledOrder);
      }
      const updated = await this.orderService.syncClosedByConditionalFill(
        position.id,
        triggerType,
      );
      return !!updated;
    } catch (e) {
      this.handleRateLimitError(e as Error);
      this.logger.debug(
        `Flat-position fallback failed for ${position.id}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  private handleRateLimitError(e: Error): void {
    const msg = e.message || '';
    if (!msg.includes('-1003') && !msg.toLowerCase().includes('too many requests')) {
      return;
    }
    const match = msg.match(/banned until (\d+)/i);
    const parsedUntil = match ? Number(match[1]) : 0;
    // 若交易所返回的解封时间已过期仍报 -1003，额外冷却 90s，避免空转刷限频
    const until = Math.max(parsedUntil + 2000, Date.now() + 90_000);
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, until);
    this.logger.warn(
      `Binance rate limited; pause exchange sync until ${new Date(this.rateLimitedUntil).toISOString()}`,
    );
  }

  private calculateUnrealizedPnl(position: Position, currentPrice: number): number {
    if (position.side === PositionSide.LONG) {
      return (currentPrice - position.entryPrice) * position.quantity;
    }
    return (position.entryPrice - currentPrice) * position.quantity;
  }
}
