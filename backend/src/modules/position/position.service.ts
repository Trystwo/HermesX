import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { ExchangeService } from '../exchange/exchange.service';
import { MarketService } from '../market/market.service';
import {
  OrderStatus,
  OrderType,
  PositionStatus,
  PositionSide,
} from '../../common/constants/enums';
import type { Order } from '@prisma/client';

@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly exchangeService: ExchangeService,
    private readonly marketService: MarketService,
  ) {}

  /**
   * 查询持仓列表
   */
  async findAll(params?: {
    strategyId?: string;
    status?: string;
    cycleId?: string;
  }) {
    const where: any = {};
    if (params?.strategyId) where.strategyId = params.strategyId;
    if (params?.status) where.status = params.status;
    if (params?.cycleId) where.cycleId = params.cycleId;

    const positions = await this.prisma.position.findMany({
      where,
      include: {
        strategy: { include: { apiConfig: true } },
        orders: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const priceMap = await this.fetchPriceMap(
      positions.map((p) => p.strategy?.symbol).filter((s): s is string => Boolean(s)),
    );

    return positions.map((p) =>
      this.toListItem(p, priceMap.get(p.strategy?.symbol ?? '')),
    );
  }

  async findOne(id: string) {
    const position = await this.prisma.position.findUnique({
      where: { id },
      include: {
        strategy: true,
        orders: true,
        logs: true,
      },
    });
    if (!position) {
      throw new NotFoundException(`Position ${id} not found`);
    }
    let currentPrice: number | undefined;
    if (position.strategy?.symbol) {
      try {
        currentPrice = await this.marketService.getPrice(position.strategy.symbol);
      } catch (e) {
        this.logger.warn(
          `Failed to fetch price for ${position.strategy.symbol}: ${(e as Error).message}`,
        );
      }
    }
    return this.toListItem(position, currentPrice);
  }

  /**
   * 单仓补挂 TP/SL
   */
  async placeTpSl(id: string) {
    return this.orderService.replenishTpSl(id);
  }

  /**
   * 批量为缺失 TP/SL 的 OPEN 仓位补挂
   */
  async placeTpSlMissing(strategyId?: string): Promise<{
    attempted: number;
    succeeded: number;
    results: Array<{ id: string; success: boolean; error?: string }>;
  }> {
    const where: any = { status: PositionStatus.OPEN };
    if (strategyId) where.strategyId = strategyId;

    const positions = await this.prisma.position.findMany({
      where,
      include: { orders: true },
      orderBy: { createdAt: 'asc' },
    });

    const missing = positions.filter((p) => this.needsTpSl(p.status, p.orders));
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const position of missing) {
      try {
        await this.orderService.replenishTpSl(position.id);
        results.push({ id: position.id, success: true });
      } catch (e) {
        const error = (e as Error).message;
        this.logger.error(`Failed to replenish TP/SL for ${position.id}: ${error}`);
        results.push({ id: position.id, success: false, error });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    this.logger.log(
      `Replenish TP/SL missing: succeeded=${succeeded}/${missing.length}` +
        (strategyId ? ` strategy=${strategyId}` : ''),
    );

    return { attempted: missing.length, succeeded, results };
  }

  /**
   * 手动平仓单个仓位
   */
  async closePosition(id: string) {
    return this.orderService.closePosition(id, 'MANUAL');
  }

  /**
   * 批量平仓(所有 OPEN 仓位)
   */
  async closeAll(strategyId?: string): Promise<{ closed: number; results: any[] }> {
    const where: any = { status: PositionStatus.OPEN };
    if (strategyId) where.strategyId = strategyId;

    const positions = await this.prisma.position.findMany({ where });

    const results: any[] = [];
    for (const position of positions) {
      try {
        const result = await this.orderService.closePosition(position.id, 'MANUAL');
        results.push({ id: position.id, success: true, position: result });
      } catch (e) {
        this.logger.error(`Failed to close position ${position.id}: ${(e as Error).message}`);
        results.push({ id: position.id, success: false, error: (e as Error).message });
      }
    }

    this.logger.log(`Closed ${results.filter((r) => r.success).length}/${positions.length} positions`);
    return { closed: results.filter((r) => r.success).length, results };
  }

  private async fetchPriceMap(symbols: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(symbols)];
    const priceMap = new Map<string, number>();
    await Promise.all(
      unique.map(async (symbol) => {
        try {
          priceMap.set(symbol, await this.marketService.getPrice(symbol));
        } catch (e) {
          this.logger.warn(`Failed to fetch price for ${symbol}: ${(e as Error).message}`);
        }
      }),
    );
    return priceMap;
  }

  private calculateUnrealizedPnl(
    side: string,
    entryPrice: number,
    quantity: number,
    currentPrice: number,
  ): number {
    if (side === PositionSide.LONG) {
      return (currentPrice - entryPrice) * quantity;
    }
    return (entryPrice - currentPrice) * quantity;
  }

  private toListItem(
    p: {
    id: string;
    strategyId: string;
    cycleId: string;
    side: string;
    entryPrice: number;
    quantity: number;
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
    status: string;
    realizedPnl: number | null;
    cycleOpenTime: Date;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    strategy?: {
      name?: string;
      symbol?: string;
      apiConfig?: { environment: string } | null;
    } | null;
    orders?: Order[];
    logs?: unknown;
  },
    currentPrice?: number,
  ) {
    const orders = p.orders ?? [];
    const tpOrder = this.latestOrder(orders, OrderType.TAKE_PROFIT_MARKET);
    const slOrder = this.latestOrder(orders, OrderType.STOP_MARKET);
    const needsTpSl = this.needsTpSl(p.status, orders);

    // 开仓具体时刻：仓位创建时间（开仓瞬间写入）
    const openedAtSrc = p.createdAt ?? p.cycleOpenTime;
    const openedAt =
      openedAtSrc instanceof Date ? openedAtSrc.toISOString() : String(openedAtSrc);

    const unrealizedPnl =
      currentPrice !== undefined && p.status === PositionStatus.OPEN
        ? this.calculateUnrealizedPnl(p.side, p.entryPrice, p.quantity, currentPrice)
        : null;

    return {
      ...p,
      strategyName: p.strategy?.name,
      symbol: p.strategy?.symbol,
      environment: p.strategy?.apiConfig?.environment ?? 'TESTNET',
      openedAt,
      currentPrice: currentPrice ?? null,
      unrealizedPnl,
      tpPlacedAt: tpOrder?.createdAt
        ? tpOrder.createdAt instanceof Date
          ? tpOrder.createdAt.toISOString()
          : String(tpOrder.createdAt)
        : null,
      slPlacedAt: slOrder?.createdAt
        ? slOrder.createdAt instanceof Date
          ? slOrder.createdAt.toISOString()
          : String(slOrder.createdAt)
        : null,
      hasPendingTp: orders.some(
        (o) => o.type === OrderType.TAKE_PROFIT_MARKET && o.status === OrderStatus.PENDING,
      ),
      hasPendingSl: orders.some(
        (o) => o.type === OrderType.STOP_MARKET && o.status === OrderStatus.PENDING,
      ),
      needsTpSl,
    };
  }

  private needsTpSl(status: string, orders: Order[]): boolean {
    if (status !== PositionStatus.OPEN) return false;
    const hasPendingTp = orders.some(
      (o) => o.type === OrderType.TAKE_PROFIT_MARKET && o.status === OrderStatus.PENDING,
    );
    const hasPendingSl = orders.some(
      (o) => o.type === OrderType.STOP_MARKET && o.status === OrderStatus.PENDING,
    );
    return !hasPendingTp || !hasPendingSl;
  }

  private latestOrder(orders: Order[], type: string): Order | undefined {
    const matched = orders.filter((o) => o.type === type);
    if (matched.length === 0) return undefined;
    return matched.reduce((a, b) =>
      a.createdAt.getTime() >= b.createdAt.getTime() ? a : b,
    );
  }

  /**
   * 仓位对账 - Hedge 模式下按 side 汇总数量对比（交易所合并仓）
   */
  async reconcile(strategyId: string): Promise<{
    matched: number;
    dbOnly: number;
    exchangeOnly: number;
    sides: Array<{
      side: string;
      dbCount: number;
      dbQty: number;
      exchangeQty: number;
      qtyDiff: number;
      status: 'MATCHED' | 'DB_HEAVY' | 'EXCHANGE_HEAVY';
    }>;
    details: any[];
  }> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${strategyId} not found`);
    }

    const dbPositions = await this.prisma.position.findMany({
      where: { strategyId, status: PositionStatus.OPEN },
    });

    const exchange = await this.exchangeService.getExchangeForStrategy(strategyId);
    const exchangePositions = await this.exchangeService.fetchPositions(exchange, [
      strategy.symbol,
    ]);

    const normalized = strategy.symbol.replace(/[:/]/g, '').toUpperCase();
    const exchangeQtyBySide = new Map<string, number>([
      ['LONG', 0],
      ['SHORT', 0],
    ]);
    const exchangeEntryBySide = new Map<string, number>();
    for (const ep of exchangePositions) {
      const pSym = (ep.symbol || '').replace(/[:/]/g, '').toUpperCase();
      const symOk =
        pSym === normalized ||
        pSym.includes(normalized) ||
        normalized.includes(pSym.replace('USDTUSDT', 'USDT'));
      if (!symOk) continue;
      const side = (ep.side || '').toUpperCase();
      if (side !== 'LONG' && side !== 'SHORT') continue;
      exchangeQtyBySide.set(side, (exchangeQtyBySide.get(side) ?? 0) + (ep.contracts || 0));
      if (ep.entryPrice != null) exchangeEntryBySide.set(side, ep.entryPrice);
    }

    const dbBySide = new Map<string, { count: number; qty: number }>([
      ['LONG', { count: 0, qty: 0 }],
      ['SHORT', { count: 0, qty: 0 }],
    ]);
    for (const p of dbPositions) {
      const side = p.side === PositionSide.LONG ? 'LONG' : 'SHORT';
      const cur = dbBySide.get(side)!;
      cur.count += 1;
      cur.qty += p.quantity;
    }

    const sides: Array<{
      side: string;
      dbCount: number;
      dbQty: number;
      exchangeQty: number;
      qtyDiff: number;
      status: 'MATCHED' | 'DB_HEAVY' | 'EXCHANGE_HEAVY';
    }> = [];
    const details: any[] = [];
    let matched = 0;
    let dbOnly = 0;
    let exchangeOnly = 0;

    for (const side of ['LONG', 'SHORT']) {
      const db = dbBySide.get(side)!;
      const exchangeQty = exchangeQtyBySide.get(side) ?? 0;
      const qtyDiff = +(db.qty - exchangeQty).toFixed(8);
      let status: 'MATCHED' | 'DB_HEAVY' | 'EXCHANGE_HEAVY' = 'MATCHED';
      if (Math.abs(qtyDiff) < 1e-8) {
        status = 'MATCHED';
        if (db.count > 0 || exchangeQty > 0) matched += 1;
      } else if (qtyDiff > 0) {
        status = 'DB_HEAVY';
        dbOnly += 1;
      } else {
        status = 'EXCHANGE_HEAVY';
        exchangeOnly += 1;
      }

      const row = {
        side,
        dbCount: db.count,
        dbQty: db.qty,
        exchangeQty,
        qtyDiff,
        status,
        entryPriceExchange: exchangeEntryBySide.get(side),
      };
      sides.push(row);
      details.push(row);
    }

    this.logger.log(
      `Reconcile strategy ${strategyId}: sides=${JSON.stringify(sides)}`,
    );

    return {
      matched,
      dbOnly,
      exchangeOnly,
      sides,
      details,
    };
  }
}
