import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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

type OpenPositionRow = Position & { strategy: Strategy; orders: Order[] };

/**
 * TP/SL 监控服务
 *
 * 同步策略（避免逐单 fetchOrder 触发币安限频）:
 * 1. 按 strategy/symbol 批量 fetchOpenOrders（含挂单时间 timestamp）
 * 2. 本地 PENDING 条件单若不在交易所挂单列表 → 视为已成交/消失
 * 3. 一侧消失、对侧仍挂着 → 同步仓位并取消对侧残留单
 * 4. 两侧都消失 → 按同向合并仓 excessQty 消化僵尸 OPEN
 * 5. 本地价格触发仅作 backup（localAutoCloseEnabled=true）
 */
@Injectable()
export class TpslMonitorService implements OnModuleInit {
  private readonly logger = new Logger(TpslMonitorService.name);
  /** 限频后暂停同步至该时间戳 */
  private rateLimitedUntil = 0;
  private syncRunning = false;
  private syncStartedAt = 0;
  /** syncRunning 超过该时长则强制复位 */
  private static readonly SYNC_WATCHDOG_MS = 60_000;
  /** 每同步 N 笔再刷新一次 openOrders，降低限频 */
  private static readonly REFRESH_EVERY_N = 5;

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
    if (this.syncRunning) {
      if (Date.now() - this.syncStartedAt > TpslMonitorService.SYNC_WATCHDOG_MS) {
        this.logger.warn(
          `TP/SL syncRunning stuck >${TpslMonitorService.SYNC_WATCHDOG_MS}ms; force reset`,
        );
        this.syncRunning = false;
      } else {
        return;
      }
    }
    if (Date.now() < this.rateLimitedUntil) return;

    this.syncRunning = true;
    this.syncStartedAt = Date.now();
    try {
      const positions = await this.prisma.position.findMany({
        where: { status: PositionStatus.OPEN },
        include: { strategy: true, orders: true },
      });
      if (positions.length === 0) return;

      const byStrategy = new Map<string, OpenPositionRow[]>();
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
   * 手动触发：对指定策略做一轮条件单对账（含撤残留挂单）
   */
  async syncStrategyConditionalFills(strategyId: string): Promise<{
    strategyId: string;
    openBefore: number;
    synced: number;
    openAfter: number;
    orphanPendingCanceled: number;
  }> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${strategyId} not found`);
    }

    const before = await this.prisma.position.count({
      where: { strategyId, status: PositionStatus.OPEN },
    });

    const positions = await this.prisma.position.findMany({
      where: { strategyId, status: PositionStatus.OPEN },
      include: { strategy: true, orders: true },
      orderBy: { createdAt: 'asc' },
    });

    const synced = await this.syncStrategyGroup(strategyId, positions);

    const orphanPendingCanceled = await this.cancelOrphanPendingOrders(strategyId);

    const after = await this.prisma.position.count({
      where: { strategyId, status: PositionStatus.OPEN },
    });

    this.logger.log(
      `Manual conditional sync strategy=${strategyId}: synced=${synced} open ${before}->${after} orphanCanceled=${orphanPendingCanceled}`,
    );

    return {
      strategyId,
      openBefore: before,
      synced,
      openAfter: after,
      orphanPendingCanceled,
    };
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

  /**
   * @returns 本轮成功同步的仓位数
   */
  private async syncStrategyGroup(
    strategyId: string,
    positions: OpenPositionRow[],
  ): Promise<number> {
    if (positions.length === 0) return 0;
    if (Date.now() < this.rateLimitedUntil) return 0;

    const symbol = positions[0].strategy.symbol;
    let adapters;
    try {
      adapters = await this.exchangeService.getAdaptersForStrategy(strategyId);
    } catch (e) {
      this.logger.warn(
        `Cannot get exchange for strategy ${strategyId}: ${(e as Error).message}`,
      );
      return 0;
    }

    let openOrders: OpenOrderInfo[];
    try {
      const lists = await Promise.all(
        adapters.map(async (exchange) => {
          const orders = await this.exchangeService.fetchOpenOrders(
            exchange,
            symbol,
          );
          return orders.map((o) => ({
            ...o,
            apiConfigId: o.apiConfigId ?? exchange.apiConfigId,
          }));
        }),
      );
      const seen = new Set<string>();
      openOrders = lists.flat().filter((o) => {
        if (!o.id) return false;
        const key = `${o.apiConfigId ?? 'unknown'}::${o.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (e) {
      this.handleRateLimitError(e as Error);
      this.logger.warn(
        `fetchOpenOrders ${symbol} failed (skip reconcile this round): ${(e as Error).message}`,
      );
      return 0;
    }

    const openIds = new Set<string>();
    for (const o of openOrders) {
      if (o.id) openIds.add(o.id);
      if (o.clientOrderId) openIds.add(o.clientOrderId);
    }

    if (openOrders.length > 0) {
      this.logger.debug(
        `Open conditional orders ${symbol}: ${openOrders.length}`,
      );
    }

    // 按 side 预取交易所合约量与 DB OPEN 总量，供「两侧都 gone」使用
    const { bySide: exchangeContractsBySide, ok: exchangePosOk } =
      await this.fetchExchangeContractsBySideMulti(adapters, symbol);
    const dbOpenQtyBySide = this.sumDbOpenQtyBySide(positions);
    const excessBySide = new Map<string, number>();
    for (const side of ['LONG', 'SHORT']) {
      const dbQty = dbOpenQtyBySide.get(side) ?? 0;
      const exQty = exchangeContractsBySide.get(side) ?? 0;
      excessBySide.set(side, dbQty - exQty);
    }

    // 先收集不对称填充（TP/SL 一侧还在），再处理两侧都 gone
    type Planned =
      | { kind: 'asymmetric'; position: OpenPositionRow; trigger: 'TP' | 'SL'; filled: Order }
      | { kind: 'bothGone'; position: OpenPositionRow; trigger: 'TP' | 'SL'; filled?: Order };

    const planned: Planned[] = [];
    const bothGoneCandidates: OpenPositionRow[] = [];
    const claimedExIds = new Set<string>();

    for (const position of positions) {
      const decision = await this.classifyAgainstOpenOrders(
        position,
        openOrders,
        claimedExIds,
      );
      if (!decision) continue;
      if (decision.kind === 'bothGone') {
        bothGoneCandidates.push(position);
      } else {
        planned.push(decision);
      }
    }

    // 两侧都 gone：按 createdAt 从旧到新，用 excessQty 消化（仓位查询失败则跳过，避免误平）
    if (exchangePosOk && bothGoneCandidates.length > 0) {
      bothGoneCandidates.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      for (const position of bothGoneCandidates) {
        const side = position.side.toUpperCase();
        const excess = excessBySide.get(side) ?? 0;
        if (excess + 1e-12 < position.quantity) {
          continue;
        }
        const trigger = await this.inferTriggerType(position);
        const pendingTp = this.latestPending(
          position.orders,
          OrderType.TAKE_PROFIT_MARKET,
        );
        const pendingSl = this.latestPending(
          position.orders,
          OrderType.STOP_MARKET,
        );
        const filled = trigger === 'TP' ? pendingTp : pendingSl;
        this.logger.warn(
          `Both TP/SL gone & excessQty for ${position.id} (${side} excess=${excess.toFixed(6)}), syncing as ${trigger}`,
        );
        planned.push({ kind: 'bothGone', position, trigger, filled });
        excessBySide.set(side, excess - position.quantity);
      }
    } else if (bothGoneCandidates.length > 0 && !exchangePosOk) {
      this.logger.warn(
        `Skip ${bothGoneCandidates.length} both-gone candidates: exchange positions unavailable`,
      );
    }

    let synced = 0;
    for (const item of planned) {
      try {
        const ok =
          item.kind === 'asymmetric'
            ? await this.applyFillSync(item.position, item.trigger, item.filled)
            : item.filled
              ? await this.applyFillSync(item.position, item.trigger, item.filled)
              : !!(await this.orderService.syncClosedByConditionalFill(
                  item.position.id,
                  item.trigger,
                ));
        if (!ok) continue;
        synced++;

        if (synced % TpslMonitorService.REFRESH_EVERY_N === 0) {
          try {
            const lists = await Promise.all(
              adapters.map(async (ex) => {
                const orders = await this.exchangeService.fetchOpenOrders(
                  ex,
                  symbol,
                );
                return orders.map((o) => ({
                  ...o,
                  apiConfigId: o.apiConfigId ?? ex.apiConfigId,
                }));
              }),
            );
            const seen = new Set<string>();
            openOrders = lists.flat().filter((o) => {
              if (!o.id) return false;
              const key = `${o.apiConfigId ?? 'unknown'}::${o.id}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            openIds.clear();
            for (const o of openOrders) {
              if (o.id) openIds.add(o.id);
              if (o.clientOrderId) openIds.add(o.clientOrderId);
            }
          } catch (e) {
            this.handleRateLimitError(e as Error);
            this.logger.warn(
              `Refresh openOrders after sync failed: ${(e as Error).message}`,
            );
            break;
          }
        }
      } catch (e) {
        this.handleRateLimitError(e as Error);
        this.logger.error(
          `Reconcile position ${item.position.id} failed: ${(e as Error).message}`,
        );
      }
    }

    return synced;
  }

  private async classifyAgainstOpenOrders(
    position: OpenPositionRow,
    openOrders: OpenOrderInfo[],
    claimedExIds: Set<string>,
  ): Promise<
    | { kind: 'asymmetric'; position: OpenPositionRow; trigger: 'TP' | 'SL'; filled: Order }
    | { kind: 'bothGone'; position: OpenPositionRow }
    | null
  > {
    const pendingTp = this.latestPending(
      position.orders,
      OrderType.TAKE_PROFIT_MARKET,
    );
    const pendingSl = this.latestPending(
      position.orders,
      OrderType.STOP_MARKET,
    );

    if (!pendingTp && !pendingSl) {
      return null;
    }

    const tpEx = pendingTp
      ? await this.orderService.findAndHealOpenConditional(
          pendingTp,
          openOrders,
          claimedExIds,
        )
      : null;
    const slEx = pendingSl
      ? await this.orderService.findAndHealOpenConditional(
          pendingSl,
          openOrders,
          claimedExIds,
        )
      : null;

    const tpAlive = !!tpEx;
    const slAlive = !!slEx;
    const tpGone = !!(pendingTp && !tpAlive);
    const slGone = !!(pendingSl && !slAlive);

    if (tpGone && slAlive) {
      this.logger.log(
        `TP gone, SL still open for ${position.id}: slId=${pendingSl!.exchangeOrderId} slPlacedAt=${
          slEx?.datetime ?? (slEx?.timestamp ? new Date(slEx.timestamp).toISOString() : '?')
        }`,
      );
      return { kind: 'asymmetric', position, trigger: 'TP', filled: pendingTp! };
    }

    if (slGone && tpAlive) {
      this.logger.log(
        `SL gone, TP still open for ${position.id}: tpId=${pendingTp!.exchangeOrderId} tpPlacedAt=${
          tpEx?.datetime ?? (tpEx?.timestamp ? new Date(tpEx.timestamp).toISOString() : '?')
        }`,
      );
      return { kind: 'asymmetric', position, trigger: 'SL', filled: pendingSl! };
    }

    if (tpGone && slGone) {
      return { kind: 'bothGone', position };
    }

    if (tpGone && !pendingSl) {
      return { kind: 'asymmetric', position, trigger: 'TP', filled: pendingTp! };
    }
    if (slGone && !pendingTp) {
      return { kind: 'asymmetric', position, trigger: 'SL', filled: pendingSl! };
    }

    return null;
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

  private async fetchExchangeContractsBySideMulti(
    adapters: Awaited<ReturnType<ExchangeService['getAdaptersForStrategy']>>,
    symbol: string,
  ): Promise<{ bySide: Map<string, number>; ok: boolean }> {
    const map = new Map<string, number>([
      ['LONG', 0],
      ['SHORT', 0],
    ]);
    let anyOk = false;
    const normalized = symbol.replace(/[:/]/g, '').toUpperCase();
    const base = normalized.replace(/USDT$|USDC$/i, '');

    for (const exchange of adapters) {
      try {
        const positions = await this.exchangeService.withTimeout(
          this.exchangeService.fetchPositions(exchange, [symbol]),
          `fetchPositions(${symbol})`,
        );
        anyOk = true;
        for (const p of positions) {
          const pSym = (p.symbol || '').replace(/[:/]/g, '').toUpperCase();
          const symOk =
            pSym === normalized ||
            pSym.includes(normalized) ||
            normalized.includes(pSym.replace('USDTUSDT', 'USDT')) ||
            pSym === base ||
            normalized.startsWith(pSym);
          if (!symOk) continue;
          const side = (p.side || '').toUpperCase();
          if (side === 'LONG' || side === 'SHORT') {
            map.set(side, (map.get(side) ?? 0) + (p.contracts || 0));
          }
        }
      } catch (e) {
        this.handleRateLimitError(e as Error);
        this.logger.warn(
          `fetchPositions for excessQty failed: ${(e as Error).message}`,
        );
      }
    }

    return { bySide: map, ok: anyOk };
  }

  private async fetchExchangeContractsBySide(
    exchange: Awaited<ReturnType<ExchangeService['getAdapterForStrategy']>>,
    symbol: string,
  ): Promise<{ bySide: Map<string, number>; ok: boolean }> {
    return this.fetchExchangeContractsBySideMulti([exchange], symbol);
  }

  private sumDbOpenQtyBySide(positions: OpenPositionRow[]): Map<string, number> {
    const map = new Map<string, number>([
      ['LONG', 0],
      ['SHORT', 0],
    ]);
    for (const p of positions) {
      const side = p.side.toUpperCase();
      map.set(side, (map.get(side) ?? 0) + p.quantity);
    }
    return map;
  }

  private async inferTriggerType(
    position: Position & { strategy: Strategy },
  ): Promise<'TP' | 'SL'> {
    try {
      const price = await this.marketService.getPrice(position.strategy.symbol);
      const tp = position.takeProfitPrice;
      const sl = position.stopLossPrice;
      if (tp != null && sl != null) {
        return Math.abs(price - tp) <= Math.abs(price - sl) ? 'TP' : 'SL';
      }
      if (sl != null && tp == null) return 'SL';
    } catch {
      // default TP
    }
    return 'TP';
  }

  /**
   * 清理已非 OPEN 仓位上残留的 PENDING 条件单（交易所 + DB）
   */
  private async cancelOrphanPendingOrders(strategyId: string): Promise<number> {
    const orphans = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        type: { in: [OrderType.TAKE_PROFIT_MARKET, OrderType.STOP_MARKET] },
        position: {
          strategyId,
          status: { not: PositionStatus.OPEN },
        },
      },
      select: { positionId: true },
      distinct: ['positionId'],
    });

    let canceled = 0;
    for (const { positionId } of orphans) {
      try {
        await this.orderService.cancelPendingOrders(positionId);
        canceled += 1;
      } catch (e) {
        this.logger.warn(
          `Cancel orphan pending for ${positionId} failed: ${(e as Error).message}`,
        );
      }
    }
    return canceled;
  }

  private handleRateLimitError(e: Error): void {
    const msg = e.message || '';
    if (!msg.includes('-1003') && !msg.toLowerCase().includes('too many requests')) {
      return;
    }
    const match = msg.match(/banned until (\d+)/i);
    const parsedUntil = match ? Number(match[1]) : 0;
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
