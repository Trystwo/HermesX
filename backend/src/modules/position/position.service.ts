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
   * 仓位对账 - 对比数据库仓位与交易所实际持仓
   */
  async reconcile(strategyId: string): Promise<{
    matched: number;
    dbOnly: number;
    exchangeOnly: number;
    details: any[];
  }> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${strategyId} not found`);
    }

    // 数据库中 OPEN 仓位
    const dbPositions = await this.prisma.position.findMany({
      where: { strategyId, status: PositionStatus.OPEN },
    });

    // 交易所实际持仓
    const exchange = await this.exchangeService.getExchangeForStrategy(strategyId);
    const exchangePositions = await this.exchangeService.fetchPositions(exchange, [strategy.symbol]);

    const details: any[] = [];
    let matched = 0;
    const matchedExchangeIds = new Set<string>();

    // 匹配数据库仓位
    for (const dbPos of dbPositions) {
      const side = dbPos.side === PositionSide.LONG ? 'LONG' : 'SHORT';
      const exchangePos = exchangePositions.find(
        (ep) => ep.side === side && Math.abs(ep.contracts - dbPos.quantity) < 0.0001,
      );

      if (exchangePos) {
        matched++;
        matchedExchangeIds.add(`${exchangePos.side}:${exchangePos.contracts}`);
        details.push({
          dbPositionId: dbPos.id,
          side: dbPos.side,
          dbQty: dbPos.quantity,
          exchangeQty: exchangePos.contracts,
          entryPriceDb: dbPos.entryPrice,
          entryPriceExchange: exchangePos.entryPrice,
          status: 'MATCHED',
        });
      } else {
        details.push({
          dbPositionId: dbPos.id,
          side: dbPos.side,
          dbQty: dbPos.quantity,
          status: 'DB_ONLY',
        });
      }
    }

    // 交易所独有仓位
    const exchangeOnly = exchangePositions.filter(
      (ep) => !matchedExchangeIds.has(`${ep.side}:${ep.contracts}`),
    );
    for (const ep of exchangeOnly) {
      details.push({
        side: ep.side,
        exchangeQty: ep.contracts,
        entryPriceExchange: ep.entryPrice,
        status: 'EXCHANGE_ONLY',
      });
    }

    this.logger.log(
      `Reconcile strategy ${strategyId}: matched=${matched}, dbOnly=${
        dbPositions.length - matched
      }, exchangeOnly=${exchangeOnly.length}`,
    );

    return {
      matched,
      dbOnly: dbPositions.length - matched,
      exchangeOnly: exchangeOnly.length,
      details,
    };
  }
}
