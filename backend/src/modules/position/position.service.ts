import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrderService } from '../order/order.service';
import { ExchangeService } from '../exchange/exchange.service';
import { PositionStatus, PositionSide } from '../../common/constants/enums';

@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly exchangeService: ExchangeService,
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

    return positions.map((p) => ({
      ...p,
      strategyName: p.strategy?.name,
      symbol: p.strategy?.symbol,
      environment: p.strategy?.apiConfig?.environment ?? 'TESTNET',
    }));
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
    return position;
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
