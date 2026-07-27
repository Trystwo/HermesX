import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ExchangeService } from '../exchange/exchange.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MarketService } from '../market/market.service';
import {
  MarginMode,
  OrderStatus,
  OrderType,
  PositionSide,
  PositionStatus,
} from '../../common/constants/enums';
import type { Strategy, Position } from '@prisma/client';

/**
 * 订单服务
 * - 调用 ExchangeService 下单/平仓
 * - 记录订单到数据库
 *
 * 关键实现: TP/SL 条件单使用 closePosition=false + 精确 quantity + positionSide
 * （双向持仓下不可传 reduceOnly，否则币安 -1106）
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly prisma: PrismaService,
    private readonly marketService: MarketService,
  ) {}

  /**
   * 开仓 - 设置杠杆、保证金模式、持仓模式、市价开仓
   * @param strategy 策略
   * @param side LONG/SHORT
   * @param quantity 数量
   */
  async openPosition(
    strategy: Strategy,
    side: PositionSide,
    quantity: number,
  ): Promise<Position> {
    this.logger.log(
      `Opening ${side} position for strategy ${strategy.name}, qty=${quantity}`,
    );

    const exchange = await this.exchangeService.getExchangeForStrategy(strategy.id);

    // 1. 设置双向持仓模式
    await this.exchangeService.setPositionMode(exchange, true);

    // 2. 设置杠杆
    await this.exchangeService.setLeverage(exchange, strategy.symbol, strategy.leverage);

    // 3. 设置保证金模式
    await this.exchangeService.setMarginMode(
      exchange,
      strategy.symbol,
      strategy.marginMode as MarginMode,
    );

    // 4. 市价开仓
    const orderSide = side === PositionSide.LONG ? 'BUY' : 'SELL';
    const orderResult = await this.exchangeService.placeOrder(exchange, {
      symbol: strategy.symbol,
      side: orderSide as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity,
      positionSide: side,
    });

    // 5. 获取入场价(用最新成交价或订单均价)
    const entryPrice = orderResult.avgPrice
      ?? (await this.marketService.getPrice(strategy.symbol));

    const cycleId = this.generateCycleId(strategy.cycleInterval);

    // 6. 创建仓位记录
    const position = await this.prisma.position.create({
      data: {
        strategyId: strategy.id,
        cycleId,
        side,
        entryPrice,
        quantity,
        status: PositionStatus.OPEN,
        cycleOpenTime: new Date(),
      },
      include: { strategy: true },
    });

    // 7. 记录开仓订单
    await this.prisma.order.create({
      data: {
        positionId: position.id,
        side: orderSide,
        type: OrderType.MARKET,
        status: orderResult.filledQty > 0 ? OrderStatus.FILLED : OrderStatus.PENDING,
        quantity,
        filledQty: orderResult.filledQty || quantity,
        exchangeOrderId: orderResult.id,
      },
    });

    // 8. 记录日志
    await this.prisma.tradeLog.create({
      data: {
        positionId: position.id,
        action: 'OPEN_POSITION',
        detail: {
          side,
          entryPrice,
          quantity,
          exchangeOrderId: orderResult.id,
        },
      },
    });

    this.logger.log(
      `Position opened: ${position.id} ${side} @ ${entryPrice} qty=${quantity}`,
    );

    return position;
  }

  /**
   * 补挂 / 重挂止盈止损：先取消该仓位残留 PENDING 条件单，再按策略参数重新挂单。
   * 用于开仓后 placeTpSl 失败留下的裸仓，或条件单丢失后的人工修复。
   */
  async replenishTpSl(positionId: string): Promise<Position> {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
    });
    if (!position) {
      throw new NotFoundException(`Position ${positionId} not found`);
    }
    if (position.status !== PositionStatus.OPEN) {
      throw new BadRequestException(
        `Position ${positionId} is ${position.status}, only OPEN positions can replenish TP/SL`,
      );
    }

    await this.cancelPendingOrders(positionId);
    await this.placeTpSl(position);

    const updated = await this.prisma.position.findUnique({
      where: { id: positionId },
    });
    if (!updated) {
      throw new NotFoundException(`Position ${positionId} not found after TP/SL`);
    }
    return updated;
  }

  /**
   * 挂止盈止损条件单
   * 关键: 精确 quantity=Q + positionSide（Hedge Mode）
   *
   * 注意: 双向持仓模式下 STOP_MARKET / TAKE_PROFIT_MARKET 不能传 reduceOnly，
   * 否则币安返回 -1106 Parameter 'reduceonly' sent when not required。
   * 也不要用 closePosition=true，否则会平掉同向全部合并仓位。
   */
  async placeTpSl(position: Position): Promise<void> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: position.strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${position.strategyId} not found`);
    }

    const exchange = await this.exchangeService.getExchangeForStrategy(strategy.id);

    // 计算 TP/SL 价格
    const tpPrice =
      position.side === PositionSide.LONG
        ? position.entryPrice * (1 + strategy.takeProfitPct / 100)
        : position.entryPrice * (1 - strategy.takeProfitPct / 100);

    const slPrice =
      position.side === PositionSide.LONG
        ? position.entryPrice * (1 - strategy.stopLossPct / 100)
        : position.entryPrice * (1 + strategy.stopLossPct / 100);

    // 保留 2 位小数精度
    const tpPriceRounded = Math.round(tpPrice * 100) / 100;
    const slPriceRounded = Math.round(slPrice * 100) / 100;

    // 下单方向(平仓反向)
    const closeSide = position.side === PositionSide.LONG ? 'SELL' : 'BUY';

    // 止盈单: TAKE_PROFIT_MARKET
    try {
      const tpOrder = await this.exchangeService.placeOrder(exchange, {
        symbol: strategy.symbol,
        side: closeSide as 'BUY' | 'SELL',
        type: 'TAKE_PROFIT_MARKET',
        quantity: position.quantity,
        stopPrice: tpPriceRounded,
        positionSide: position.side as 'LONG' | 'SHORT',
      });

      await this.prisma.order.create({
        data: {
          positionId: position.id,
          side: closeSide,
          type: OrderType.TAKE_PROFIT_MARKET,
          status: OrderStatus.PENDING,
          price: tpPriceRounded,
          stopPrice: tpPriceRounded,
          quantity: position.quantity,
          exchangeOrderId: tpOrder.id,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to place TP order for position ${position.id}: ${(e as Error).message}`,
      );
      throw e;
    }

    // 止损单: STOP_MARKET
    try {
      const slOrder = await this.exchangeService.placeOrder(exchange, {
        symbol: strategy.symbol,
        side: closeSide as 'BUY' | 'SELL',
        type: 'STOP_MARKET',
        quantity: position.quantity,
        stopPrice: slPriceRounded,
        positionSide: position.side as 'LONG' | 'SHORT',
      });

      await this.prisma.order.create({
        data: {
          positionId: position.id,
          side: closeSide,
          type: OrderType.STOP_MARKET,
          status: OrderStatus.PENDING,
          price: slPriceRounded,
          stopPrice: slPriceRounded,
          quantity: position.quantity,
          exchangeOrderId: slOrder.id,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to place SL order for position ${position.id}: ${(e as Error).message}`,
      );
      throw e;
    }

    // 更新仓位的 TP/SL 价格
    await this.prisma.position.update({
      where: { id: position.id },
      data: {
        takeProfitPrice: tpPriceRounded,
        stopLossPrice: slPriceRounded,
      },
    });

    await this.prisma.tradeLog.create({
      data: {
        positionId: position.id,
        action: 'PLACE_TP_SL',
        detail: {
          takeProfitPrice: tpPriceRounded,
          stopLossPrice: slPriceRounded,
          quantity: position.quantity,
          closePosition: false,
        },
      },
    });

    this.logger.log(
      `TP/SL placed for position ${position.id}: TP=${tpPriceRounded} SL=${slPriceRounded}`,
    );
  }

  /**
   * 手动平仓
   * 若交易所返回 -2022（ReduceOnly 被拒），核对交易所同向仓位；
   * 若已无仓（通常 TP/SL 已成交），则将本地状态同步为已平，避免僵尸 OPEN。
   */
  async closePosition(positionId: string, reason: string = 'MANUAL'): Promise<Position> {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      include: { strategy: true },
    });
    if (!position) {
      throw new NotFoundException(`Position ${positionId} not found`);
    }
    if (position.status !== PositionStatus.OPEN) {
      throw new ConflictException(
        `Position ${positionId} is not OPEN (status=${position.status})`,
      );
    }

    const exchange = await this.exchangeService.getExchangeForStrategy(position.strategyId);

    // 市价平仓
    let orderResult;
    try {
      orderResult = await this.exchangeService.closePosition(
        exchange,
        position.strategy.symbol,
        position.side as PositionSide,
        position.quantity,
      );
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`Exchange close failed for ${positionId}: ${msg}`);

      // -2022: ReduceOnly 被拒 → 多半交易所已无该方向仓位
      if (this.isReduceOnlyRejected(msg)) {
        const synced = await this.trySyncIfExchangeFlat(
          position,
          exchange,
          reason,
          msg,
        );
        if (synced) return synced;
      }

      throw new BadRequestException(`平仓失败: ${msg}`);
    }

    // 计算已实现盈亏（均价缺失时用入场价兜底，避免 getPrice 硬编码 TESTNET 导致二次失败）
    const closePrice =
      orderResult.avgPrice
      ?? (await this.marketService.getPrice(position.strategy.symbol).catch(() => position.entryPrice));
    const realizedPnl = this.calculatePnl(
      position.side,
      position.entryPrice,
      closePrice,
      position.quantity,
    );

    // 更新仓位
    const updated = await this.prisma.position.update({
      where: { id: positionId },
      data: {
        status: reason === 'TP_HIT' ? PositionStatus.TP_HIT
          : reason === 'SL_HIT' ? PositionStatus.SL_HIT
          : PositionStatus.MANUAL,
        realizedPnl,
        closedAt: new Date(),
      },
      include: { strategy: true },
    });

    // 记录平仓订单
    await this.prisma.order.create({
      data: {
        positionId: position.id,
        side: position.side === PositionSide.LONG ? 'SELL' : 'BUY',
        type: OrderType.MARKET,
        status: OrderStatus.FILLED,
        quantity: position.quantity,
        filledQty: orderResult.filledQty || position.quantity,
        exchangeOrderId: orderResult.id,
      },
    });

    // 取消该仓位残留的 TP/SL 条件单
    await this.cancelPendingOrders(positionId);

    await this.prisma.tradeLog.create({
      data: {
        positionId: position.id,
        action: 'CLOSE_POSITION',
        detail: {
          reason,
          closePrice,
          realizedPnl,
          exchangeOrderId: orderResult.id,
        },
      },
    });

    this.logger.log(
      `Position ${positionId} closed (${reason}), pnl=${realizedPnl}`,
    );

    return updated;
  }

  /**
   * 识别币安 -2022 / ReduceOnly Order is rejected
   */
  private isReduceOnlyRejected(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes('-2022') || m.includes('reduceonly order is rejected');
  }

  /**
   * 查询交易所同向合约数量；符号兼容 BTCUSDT 与 BTC/USDT:USDT
   */
  private async getExchangeSideContracts(
    exchange: Awaited<ReturnType<ExchangeService['getExchangeForStrategy']>>,
    symbol: string,
    side: string,
  ): Promise<number> {
    const positions = await this.exchangeService.fetchPositions(exchange, [symbol]);
    const normalized = symbol.replace(/[:/]/g, '').toUpperCase();
    const targetSide = side.toUpperCase();

    const match = positions.find((p) => {
      const pSym = (p.symbol || '').replace(/[:/]/g, '').toUpperCase();
      const symOk =
        pSym === normalized ||
        pSym.includes(normalized) ||
        normalized.includes(pSym.replace('USDTUSDT', 'USDT'));
      return symOk && p.side === targetSide;
    });

    return match?.contracts ?? 0;
  }

  /**
   * 交易所同向仓位已为 0 时，将本地 OPEN 同步为已平
   */
  private async trySyncIfExchangeFlat(
    position: Position & { strategy: Strategy },
    exchange: Awaited<ReturnType<ExchangeService['getExchangeForStrategy']>>,
    reason: string,
    originalError: string,
  ): Promise<Position | null> {
    try {
      const contracts = await this.getExchangeSideContracts(
        exchange,
        position.strategy.symbol,
        position.side,
      );

      // 仍有足够仓位可平 → 不是「已平」场景，交还给上层报错
      if (contracts + 1e-12 >= position.quantity) {
        this.logger.warn(
          `ReduceOnly rejected but exchange still has ${contracts} ${position.side} on ${position.strategy.symbol}; not syncing ${position.id}`,
        );
        return null;
      }

      const closePrice = await this.marketService
        .getPrice(position.strategy.symbol)
        .catch(() => position.entryPrice);
      const realizedPnl = this.calculatePnl(
        position.side,
        position.entryPrice,
        closePrice,
        position.quantity,
      );

      // 优先保留调用方 reason；手动平仓时标 CLOSED（表示交易所侧已无仓后同步）
      const status =
        reason === 'TP_HIT'
          ? PositionStatus.TP_HIT
          : reason === 'SL_HIT'
            ? PositionStatus.SL_HIT
            : PositionStatus.CLOSED;

      const updated = await this.prisma.position.update({
        where: { id: position.id },
        data: {
          status,
          realizedPnl,
          closedAt: new Date(),
        },
        include: { strategy: true },
      });

      await this.cancelPendingOrders(position.id);

      await this.prisma.tradeLog.create({
        data: {
          positionId: position.id,
          action: 'SYNC_ALREADY_CLOSED',
          detail: {
            reason,
            originalError,
            exchangeSideContracts: contracts,
            closePrice,
            realizedPnl,
            note: '交易所无对应仓位（多为 TP/SL 已成交），本地状态已同步为已平',
          },
        },
      });

      this.logger.warn(
        `Position ${position.id} synced as ${status}: exchange ${position.side} contracts=${contracts} (< qty ${position.quantity})`,
      );

      return updated;
    } catch (syncErr) {
      this.logger.error(
        `Failed to sync already-closed position ${position.id}: ${(syncErr as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 交易所 TP/SL 条件单已成交后，同步本地仓位并取消对侧残留挂单。
   * Binance 条件单非 OCO：一侧成交后另一侧不会自动撤销。
   */
  async syncClosedByConditionalFill(
    positionId: string,
    triggerType: 'TP' | 'SL',
    opts?: {
      filledOrderId?: string;
      fillPrice?: number;
      filledQty?: number;
    },
  ): Promise<Position | null> {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      include: { strategy: true },
    });
    if (!position || position.status !== PositionStatus.OPEN) {
      return null;
    }

    const closePrice =
      opts?.fillPrice ??
      (await this.marketService
        .getPrice(position.strategy.symbol)
        .catch(() => position.entryPrice));
    const realizedPnl = this.calculatePnl(
      position.side,
      position.entryPrice,
      closePrice,
      position.quantity,
    );
    const status =
      triggerType === 'TP' ? PositionStatus.TP_HIT : PositionStatus.SL_HIT;

    // 先标记已成交的条件单，避免随后 cancel 时被误标为 CANCELED
    if (opts?.filledOrderId) {
      await this.prisma.order.update({
        where: { id: opts.filledOrderId },
        data: {
          status: OrderStatus.FILLED,
          filledQty: opts.filledQty ?? position.quantity,
          price: closePrice,
        },
      });
    } else {
      const filledType =
        triggerType === 'TP'
          ? OrderType.TAKE_PROFIT_MARKET
          : OrderType.STOP_MARKET;
      const pendingFill = await this.prisma.order.findFirst({
        where: {
          positionId,
          type: filledType,
          status: OrderStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (pendingFill) {
        await this.prisma.order.update({
          where: { id: pendingFill.id },
          data: {
            status: OrderStatus.FILLED,
            filledQty: opts?.filledQty ?? position.quantity,
            price: closePrice,
          },
        });
      }
    }

    const updated = await this.prisma.position.update({
      where: { id: positionId },
      data: {
        status,
        realizedPnl,
        closedAt: new Date(),
      },
      include: { strategy: true },
    });

    // 取消对侧残留挂单（另一侧 STOP / TAKE_PROFIT）
    await this.cancelPendingOrders(positionId);

    await this.prisma.tradeLog.create({
      data: {
        positionId,
        action: `${triggerType}_SYNCED`,
        detail: {
          triggerType,
          closePrice,
          realizedPnl,
          filledOrderId: opts?.filledOrderId,
          syncedAt: new Date().toISOString(),
          note: '交易所条件单已成交，本地已同步并取消残留挂单',
        },
      },
    });

    this.logger.log(
      `Position ${positionId} synced to ${status} after exchange ${triggerType} fill, pnl=${realizedPnl}`,
    );

    return updated;
  }

  /**
   * 取消仓位的所有挂单(TP/SL)
   */
  async cancelPendingOrders(positionId: string): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { positionId, status: OrderStatus.PENDING },
      include: { position: { include: { strategy: true } } },
    });

    if (orders.length === 0) return;

    const exchange = await this.exchangeService.getExchangeForStrategy(
      orders[0].position.strategyId,
    );

    for (const order of orders) {
      if (order.exchangeOrderId) {
        try {
          await this.exchangeService.cancelOrder(
            exchange,
            order.exchangeOrderId,
            order.position.strategy.symbol,
          );
        } catch (e) {
          this.logger.warn(
            `Failed to cancel order ${order.exchangeOrderId}: ${(e as Error).message}`,
          );
        }
      }
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELED },
      });
    }
  }

  /**
   * 计算盈亏
   */
  private calculatePnl(
    side: string,
    entryPrice: number,
    closePrice: number,
    quantity: number,
  ): number {
    if (side === PositionSide.LONG) {
      return (closePrice - entryPrice) * quantity;
    } else {
      return (entryPrice - closePrice) * quantity;
    }
  }

  /**
   * 分页查询订单（含策略/交易对，供控制台展示）
   */
  async findAll(params?: {
    status?: string;
    strategyId?: string;
    symbol?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const where: Record<string, unknown> = {};

    if (params?.status) {
      // 前端 FAILED ↔ 后端 REJECTED
      where.status =
        params.status === 'FAILED' ? OrderStatus.REJECTED : params.status;
    }
    if (params?.strategyId || params?.symbol) {
      where.position = {
        ...(params.strategyId ? { strategyId: params.strategyId } : {}),
        ...(params.symbol
          ? { strategy: { symbol: params.symbol.toUpperCase() } }
          : {}),
      };
    }

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          position: {
            include: { strategy: { include: { apiConfig: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = rows.map((o) => this.toListItem(o));
    return { items, total, page, pageSize };
  }

  private toListItem(order: {
    id: string;
    positionId: string;
    side: string;
    type: string;
    status: string;
    price: number | null;
    stopPrice: number | null;
    quantity: number;
    filledQty: number | null;
    exchangeOrderId: string | null;
    createdAt: Date;
    updatedAt: Date;
    position: {
      id: string;
      side: string;
      cycleId: string;
      entryPrice: number;
      strategyId: string;
      strategy: {
        id: string;
        name: string;
        symbol: string;
        apiConfig: { environment: string } | null;
      };
    };
  }) {
    const pos = order.position;
    const uiType = this.mapUiOrderType(order.type, order.side, pos.side);
    const uiStatus =
      order.status === OrderStatus.REJECTED ? 'FAILED' : order.status;

    return {
      id: order.id,
      orderId: order.exchangeOrderId ?? order.id,
      strategyId: pos.strategyId,
      strategyName: pos.strategy.name,
      symbol: pos.strategy.symbol,
      side: pos.side as PositionSide,
      type: uiType,
      quantity: order.quantity,
      price: order.price ?? order.stopPrice ?? pos.entryPrice,
      avgFillPrice:
        order.filledQty && order.filledQty > 0
          ? order.price ?? pos.entryPrice
          : null,
      status: uiStatus,
      environment: pos.strategy.apiConfig?.environment ?? 'TESTNET',
      positionId: pos.id,
      cycleId: pos.cycleId,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /** 后端交易所订单类型 → 前端展示类型 */
  private mapUiOrderType(
    dbType: string,
    orderSide: string,
    positionSide: string,
  ): string {
    if (dbType === OrderType.TAKE_PROFIT_MARKET) return 'TP';
    if (dbType === OrderType.STOP_MARKET) return 'SL';
    // MARKET: 开仓方向与仓位同向 → OPEN，否则为平仓
    const isOpen =
      (positionSide === PositionSide.LONG && orderSide === 'BUY') ||
      (positionSide === PositionSide.SHORT && orderSide === 'SELL');
    return isOpen ? 'OPEN' : 'MANUAL_CLOSE';
  }

  /**
   * 生成周期 ID(用于同周期多+空配对)
   */
  private generateCycleId(cycleInterval: string): string {
    const now = new Date();
    return `${cycleInterval}:${now.toISOString().slice(0, 16)}`;
  }
}
