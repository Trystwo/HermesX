import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ExchangeService } from '../exchange/exchange.service';
import type { ExchangeAdapter } from '../exchange/adapters/exchange-adapter';
import type { OpenOrderInfo } from '../exchange/exchange.types';
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

export type OrphanKind = 'exchange_orphan' | 'db_orphan';

export interface OrphanOrderInfo {
  kind: OrphanKind;
  algoId: string;
  orderType: string;
  side: string;
  positionSide?: string | null;
  triggerPrice: number | null;
  quantity: number;
  createTime: string | null;
  symbol: string;
  strategyId: string;
  strategyName: string;
  positionId: string | null;
  positionStatus: string | null;
  dbOrderId: string | null;
  /** 交易所孤儿所属子账户 ApiConfig；清理时按此选适配器 */
  apiConfigId?: string | null;
}

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

    const exchange = await this.exchangeService.getAdapterForStrategy(
      strategy.id,
      side,
    );

    // 1. 设置双向持仓模式（Lighter 无 hedge，adapter 内 no-op）
    if (exchange.supportsHedgeMode) {
      await this.exchangeService.setPositionMode(exchange, true);
    }

    // 2. 先保证金模式、再杠杆（Lighter 的 update_leverage 一次设置两者；
    //    若先杠杆后保证金，旧实现曾用默认 10x 覆盖策略杠杆）
    await this.exchangeService.setMarginMode(
      exchange,
      strategy.symbol,
      strategy.marginMode as MarginMode,
    );
    await this.exchangeService.setLeverage(
      exchange,
      strategy.symbol,
      strategy.leverage,
    );

    // 4. 市价开仓（Binance 用 positionSide；Lighter 用净持仓 buy/sell）
    const orderSide = side === PositionSide.LONG ? 'BUY' : 'SELL';
    const orderResult = await this.exchangeService.placeOrder(exchange, {
      symbol: strategy.symbol,
      side: orderSide as 'BUY' | 'SELL',
      type: 'MARKET',
      quantity,
      ...(exchange.supportsHedgeMode ? { positionSide: side } : {}),
    });

    // 5. 成交均价：禁止回退到跨环境 MarketService 缓存（曾导致 BTCUSDC 长期写成 64803.4）
    const entryPrice = await this.exchangeService.resolveFillPrice(
      exchange,
      orderResult,
      strategy.symbol,
    );

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
   *
   * -2021 Order would immediately trigger：相对 mark 已越过触发价时，改为市价止盈/止损平仓。
   */
  async placeTpSl(position: Position): Promise<void> {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: position.strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${position.strategyId} not found`);
    }

    const exchange = await this.exchangeService.getAdapterForStrategy(
      strategy.id,
      position.side as 'LONG' | 'SHORT',
    );

    // Lighter 单市场挂单有上限；先清掉无法对应本地 OPEN PENDING 的残留条件单
    try {
      const freed = await this.freeUnmatchedLighterConditionals(
        strategy.id,
        position.side as 'LONG' | 'SHORT',
        strategy.symbol,
        exchange,
      );
      if (freed > 0) {
        this.logger.log(
          `Freed ${freed} unmatched Lighter conditionals before TP/SL for ${position.id}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `freeUnmatchedLighterConditionals failed: ${(e as Error).message}`,
      );
    }

    const ticker = await this.exchangeService.fetchTicker(exchange, strategy.symbol);
    const mark = ticker.lastPrice;

    // 入场价相对 mark 偏离过大，或从未成功挂过 TP/SL（历史脏价）→ 纠正后再算
    let entry = position.entryPrice;
    const neverPlacedTpSl =
      position.takeProfitPrice == null && position.stopLossPrice == null;
    const divergePct =
      mark > 0 && entry > 0 ? Math.abs(entry - mark) / mark : 0;
    if (mark > 0 && entry > 0 && (neverPlacedTpSl || divergePct > 0.005)) {
      this.logger.warn(
        `Correcting entryPrice ${entry} → mark ${mark} for position ${position.id}` +
          ` (neverPlacedTpSl=${neverPlacedTpSl}, diverge=${(divergePct * 100).toFixed(2)}%)`,
      );
      entry = mark;
      await this.prisma.position.update({
        where: { id: position.id },
        data: { entryPrice: mark },
      });
      position = { ...position, entryPrice: mark };
    }

    let tpPrice =
      position.side === PositionSide.LONG
        ? entry * (1 + strategy.takeProfitPct / 100)
        : entry * (1 - strategy.takeProfitPct / 100);

    let slPrice =
      position.side === PositionSide.LONG
        ? entry * (1 - strategy.stopLossPct / 100)
        : entry * (1 + strategy.stopLossPct / 100);

    let tpPriceRounded = this.roundTriggerPrice(tpPrice);
    let slPriceRounded = this.roundTriggerPrice(slPrice);

    // 相对 mark 已越过 TP/SL → 直接市价了结，避免 -2021
    if (mark > 0 && this.isPastTakeProfit(position.side, mark, tpPriceRounded)) {
      this.logger.warn(
        `Mark ${mark} already past TP ${tpPriceRounded} for ${position.id}, closing as TP_HIT`,
      );
      await this.closePosition(position.id, 'TP_HIT');
      return;
    }
    if (mark > 0 && this.isPastStopLoss(position.side, mark, slPriceRounded)) {
      this.logger.warn(
        `Mark ${mark} already past SL ${slPriceRounded} for ${position.id}, closing as SL_HIT`,
      );
      await this.closePosition(position.id, 'SL_HIT');
      return;
    }

    // 与 mark 保留极小间距，降低「刚好贴价」触发 -2021
    const minGapPct = 0.0005;
    if (mark > 0) {
      tpPriceRounded = this.ensureTpDistance(
        position.side,
        mark,
        tpPriceRounded,
        minGapPct,
      );
      slPriceRounded = this.ensureSlDistance(
        position.side,
        mark,
        slPriceRounded,
        minGapPct,
      );
    }

    const closeSide = position.side === PositionSide.LONG ? 'SELL' : 'BUY';

    // 止盈单
    try {
      const tpOrder = await this.placeConditionalOrClose(
        exchange,
        position,
        strategy.symbol,
        {
          side: closeSide as 'BUY' | 'SELL',
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: tpPriceRounded,
          hitReason: 'TP_HIT',
        },
      );
      if (!tpOrder) return; // 已按 TP 市价平仓

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
      this.toHttpExchangeError(e, '挂止盈');
    }

    // 止损单
    try {
      const slOrder = await this.placeConditionalOrClose(
        exchange,
        position,
        strategy.symbol,
        {
          side: closeSide as 'BUY' | 'SELL',
          type: 'STOP_MARKET',
          stopPrice: slPriceRounded,
          hitReason: 'SL_HIT',
        },
      );
      if (!slOrder) return; // 已按 SL 市价平仓（并会取消刚挂的 TP）

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
      this.toHttpExchangeError(e, '挂止损');
    }

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
          markPrice: mark,
        },
      },
    });

    this.logger.log(
      `TP/SL placed for position ${position.id}: TP=${tpPriceRounded} SL=${slPriceRounded}`,
    );
  }

  private roundTriggerPrice(price: number): number {
    return Math.round(price * 100) / 100;
  }

  private isImmediatelyTriggerError(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes('-2021') || m.includes('immediately trigger');
  }

  private isPastTakeProfit(side: string, mark: number, tp: number): boolean {
    return side === PositionSide.LONG ? mark >= tp : mark <= tp;
  }

  private isPastStopLoss(side: string, mark: number, sl: number): boolean {
    return side === PositionSide.LONG ? mark <= sl : mark >= sl;
  }

  private ensureTpDistance(
    side: string,
    mark: number,
    tp: number,
    minGapPct: number,
  ): number {
    if (side === PositionSide.LONG) {
      const minTp = mark * (1 + minGapPct);
      return this.roundTriggerPrice(Math.max(tp, minTp));
    }
    const maxTp = mark * (1 - minGapPct);
    return this.roundTriggerPrice(Math.min(tp, maxTp));
  }

  private ensureSlDistance(
    side: string,
    mark: number,
    sl: number,
    minGapPct: number,
  ): number {
    if (side === PositionSide.LONG) {
      const maxSl = mark * (1 - minGapPct);
      return this.roundTriggerPrice(Math.min(sl, maxSl));
    }
    const minSl = mark * (1 + minGapPct);
    return this.roundTriggerPrice(Math.max(sl, minSl));
  }

  /**
   * 挂条件单；若 -2021 则按 hitReason 市价平仓并返回 null
   */
  private async placeConditionalOrClose(
    exchange: Awaited<ReturnType<ExchangeService['getAdapterForStrategy']>>,
    position: Position,
    symbol: string,
    opts: {
      side: 'BUY' | 'SELL';
      type: 'TAKE_PROFIT_MARKET' | 'STOP_MARKET';
      stopPrice: number;
      hitReason: 'TP_HIT' | 'SL_HIT';
    },
  ): Promise<{ id: string } | null> {
    try {
      return await this.exchangeService.placeOrder(exchange, {
        symbol,
        side: opts.side,
        type: opts.type,
        quantity: position.quantity,
        stopPrice: opts.stopPrice,
        // Binance hedge: positionSide；Lighter 净持仓: reduceOnly
        ...(exchange.supportsHedgeMode
          ? { positionSide: position.side as 'LONG' | 'SHORT' }
          : { reduceOnly: true }),
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (!this.isImmediatelyTriggerError(msg)) throw e;

      this.logger.warn(
        `${opts.type} -2021 for ${position.id} @ ${opts.stopPrice}, closing as ${opts.hitReason}`,
      );
      await this.closePosition(position.id, opts.hitReason);
      return null;
    }
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

    const exchange = await this.exchangeService.getAdapterForStrategy(
      position.strategyId,
      position.side as 'LONG' | 'SHORT',
    );

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
    exchange: Awaited<ReturnType<ExchangeService['getAdapterForStrategy']>>,
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
    exchange: Awaited<ReturnType<ExchangeService['getAdapterForStrategy']>>,
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

    const side = orders[0].position.side as 'LONG' | 'SHORT';
    const symbol = orders[0].position.strategy.symbol;
    const exchange = await this.exchangeService.getAdapterForStrategy(
      orders[0].position.strategyId,
      side,
    );

    let openOrders: OpenOrderInfo[] = [];
    try {
      openOrders = await this.exchangeService.fetchOpenOrders(exchange, symbol);
    } catch (e) {
      this.logger.warn(
        `cancelPendingOrders fetchOpenOrders failed: ${(e as Error).message}`,
      );
    }

    const claimed = new Set<string>();
    for (const order of orders) {
      if (order.exchangeOrderId || order.stopPrice != null) {
        const matched = await this.findAndHealOpenConditional(
          {
            id: order.id,
            exchangeOrderId: order.exchangeOrderId,
            type: order.type,
            side: order.side,
            stopPrice: order.stopPrice,
          },
          openOrders,
          claimed,
        );
        const cancelId = matched?.id ?? order.exchangeOrderId;
        if (cancelId) {
          try {
            await this.exchangeService.cancelOrder(exchange, cancelId, symbol);
          } catch (e) {
            this.logger.warn(
              `Failed to cancel order ${cancelId}: ${(e as Error).message}`,
            );
          }
        }
      }
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELED },
      });
    }
  }

  /**
   * Lighter 单市场挂单有上限。挂 TP/SL 前撤掉本账户上无法对应到 OPEN PENDING 的条件单，腾出名额。
   */
  /**
   * Lighter 单市场挂单有上限。挂 TP/SL 前撤掉本账户上无法对应到 OPEN PENDING 的条件单，腾出名额。
   */
  private async freeUnmatchedLighterConditionals(
    _strategyId: string,
    side: 'LONG' | 'SHORT',
    symbol: string,
    exchange: ExchangeAdapter,
  ): Promise<number> {
    if (exchange.exchangeName !== 'LIGHTER') return 0;

    const openOrders = await this.exchangeService.fetchOpenOrders(
      exchange,
      symbol,
    );
    const conditional = openOrders.filter((o) => {
      const t = (o.type || '').toLowerCase();
      return (
        t.includes('stop') ||
        t.includes('take_profit') ||
        t.includes('takeprofit')
      );
    });
    if (conditional.length === 0) return 0;

    const pendingRows = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        type: {
          in: [OrderType.TAKE_PROFIT_MARKET, OrderType.STOP_MARKET],
        },
        position: {
          status: PositionStatus.OPEN,
          side,
          strategy: {
            symbol,
            ...(side === 'SHORT'
              ? {
                  OR: [
                    { shortApiConfigId: exchange.apiConfigId },
                    {
                      shortApiConfigId: null,
                      apiConfigId: exchange.apiConfigId,
                    },
                  ],
                }
              : { apiConfigId: exchange.apiConfigId }),
          },
        },
      },
      select: {
        id: true,
        exchangeOrderId: true,
        type: true,
        side: true,
        stopPrice: true,
      },
    });

    const claimed = new Set<string>();
    for (const row of pendingRows) {
      await this.findAndHealOpenConditional(row, conditional, claimed);
    }

    let canceled = 0;
    for (const o of conditional) {
      if (!o.id || claimed.has(o.id)) continue;
      try {
        await this.exchangeService.cancelOrder(exchange, o.id, symbol);
        canceled++;
        this.logger.log(
          `Freed unmatched Lighter conditional ${o.id} ${o.type} @${o.stopPrice} on ${side}`,
        );
      } catch (e) {
        this.logger.warn(
          `Free unmatched conditional ${o.id} failed: ${(e as Error).message}`,
        );
      }
    }
    return canceled;
  }

  private toHttpExchangeError(e: unknown, context: string): never {
    const message = (e as Error)?.message || String(e);
    const lower = message.toLowerCase();
    if (
      lower.includes('maximum pending') ||
      lower.includes('pending order count')
    ) {
      throw new BadRequestException(
        `${context}失败：Lighter 该市场挂单已达上限。请先「检查/清理孤儿单」，或平掉多余仓位后再补挂。原始错误：${message}`,
      );
    }
    if (e instanceof BadRequestException || e instanceof NotFoundException) {
      throw e;
    }
    throw new BadRequestException(`${context}失败：${message}`);
  }

  /**
   * 检查孤儿条件单：
   * - exchange_orphan：交易所挂着、本地无 PENDING 记录
   * - db_orphan：仓位已非 OPEN、本地仍 PENDING
   * 按 apiConfigId+symbol 聚合，避免误判同账户同币种其它策略的合法挂单。
   * Lighter 双子账户：同时扫多/空腿，并用 order_index + client_order_index 对齐本地 ID。
   */
  async checkOrphanOrders(strategyId?: string): Promise<{
    orphans: OrphanOrderInfo[];
    exchangeOpen: number;
    pendingDb: number;
  }> {
    const groups = await this.resolveOrphanScanGroups(strategyId);
    const orphans: OrphanOrderInfo[] = [];
    let exchangeOpen = 0;
    let pendingDb = 0;

    for (const group of groups) {
      const pendingRows = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING,
          type: {
            in: [OrderType.TAKE_PROFIT_MARKET, OrderType.STOP_MARKET],
          },
          position: {
            strategy: {
              symbol: group.symbol,
              OR: [
                ...(group.apiConfigId
                  ? [{ apiConfigId: group.apiConfigId }]
                  : [{ apiConfigId: null }]),
                ...(group.shortApiConfigId
                  ? [{ shortApiConfigId: group.shortApiConfigId }]
                  : []),
                ...(group.apiConfigId
                  ? [{ shortApiConfigId: group.apiConfigId }]
                  : []),
              ],
            },
          },
        },
        select: {
          id: true,
          exchangeOrderId: true,
          type: true,
          side: true,
          stopPrice: true,
          quantity: true,
          createdAt: true,
          positionId: true,
          position: {
            select: {
              id: true,
              status: true,
              side: true,
              strategyId: true,
              strategy: { select: { name: true } },
            },
          },
        },
      });

      // OPEN 仓位上的 PENDING：可按 类型+方向+触发价 与交易所挂单对齐（兼容历史 tx_hash）
      const openPendingPool = pendingRows.filter(
        (r) => r.position.status === PositionStatus.OPEN,
      );
      const usedPendingIds = new Set<string>();
      pendingDb += pendingRows.length;

      let openOrders;
      try {
        const adapters = await this.exchangeService.getAdaptersForStrategy(
          group.strategyId,
        );
        const lists = await Promise.all(
          adapters.map(async (ex) => {
            const orders = await this.exchangeService.fetchOpenOrders(
              ex,
              group.symbol,
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
      } catch (e) {
        this.logger.warn(
          `checkOrphanOrders fetchOpenOrders failed for ${group.symbol}: ${(e as Error).message}`,
        );
        throw e;
      }

      const conditional = openOrders.filter((o) => {
        const t = (o.type || '').toLowerCase();
        return (
          t.includes('stop') ||
          t.includes('take_profit') ||
          t.includes('takeprofit')
        );
      });
      exchangeOpen += conditional.length;

      const idHealUpdates: Array<{ dbId: string; exchangeOrderId: string }> = [];

      for (const o of conditional) {
        if (!o.id) continue;

        // 1) 精确 ID：order_index / client_order_index
        let matched = openPendingPool.find(
          (r) =>
            !usedPendingIds.has(r.id) &&
            ((r.exchangeOrderId && r.exchangeOrderId === o.id) ||
              (r.exchangeOrderId &&
                o.clientOrderId &&
                r.exchangeOrderId === o.clientOrderId)),
        );

        // 2) 特征匹配：本地历史常存 tx_hash，与交易所 order_index 对不上
        if (!matched) {
          matched = openPendingPool.find(
            (r) =>
              !usedPendingIds.has(r.id) &&
              this.conditionalOrdersMatch(
                r.type,
                r.side,
                r.stopPrice,
                o.type,
                o.side,
                o.stopPrice ?? null,
              ),
          );
          if (matched && matched.exchangeOrderId !== o.id) {
            idHealUpdates.push({ dbId: matched.id, exchangeOrderId: o.id });
          }
        }

        if (matched) {
          usedPendingIds.add(matched.id);
          continue;
        }

        // 兜底：查任意历史记录（可能仓位已关）
        const histRow = pendingRows.find(
          (r) =>
            r.exchangeOrderId === o.id ||
            (!!o.clientOrderId && r.exchangeOrderId === o.clientOrderId),
        );
        const hist =
          histRow ??
          (await this.prisma.order.findFirst({
            where: {
              OR: [
                { exchangeOrderId: o.id },
                ...(o.clientOrderId
                  ? [{ exchangeOrderId: o.clientOrderId }]
                  : []),
              ],
            },
            include: {
              position: {
                select: {
                  id: true,
                  status: true,
                  side: true,
                  strategyId: true,
                  strategy: { select: { name: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }));

        const histPos =
          hist && 'position' in hist
            ? hist.position
            : histRow
              ? histRow.position
              : null;

        orphans.push({
          kind: 'exchange_orphan',
          algoId: o.id,
          orderType: o.type,
          side: o.side,
          positionSide: o.positionSide ?? histPos?.side ?? null,
          triggerPrice: o.stopPrice ?? null,
          quantity: o.amount,
          createTime:
            o.datetime ??
            (o.timestamp ? new Date(o.timestamp).toISOString() : null),
          symbol: group.symbol,
          strategyId: histPos?.strategyId ?? group.strategyId,
          strategyName: histPos?.strategy.name ?? group.strategyName,
          positionId:
            (hist && 'positionId' in hist ? hist.positionId : null) ??
            histPos?.id ??
            null,
          positionStatus: histPos?.status ?? null,
          dbOrderId: hist?.id ?? null,
          apiConfigId: o.apiConfigId ?? null,
        });
      }

      // 把对上的真实 order_index 写回本地，修复监控/下次对账
      for (const u of idHealUpdates) {
        try {
          await this.prisma.order.update({
            where: { id: u.dbId },
            data: { exchangeOrderId: u.exchangeOrderId },
          });
        } catch (e) {
          this.logger.warn(
            `heal exchangeOrderId ${u.dbId}→${u.exchangeOrderId} failed: ${(e as Error).message}`,
          );
        }
      }

      for (const row of pendingRows) {
        if (row.position.status === PositionStatus.OPEN) continue;
        orphans.push({
          kind: 'db_orphan',
          algoId: row.exchangeOrderId ?? row.id,
          orderType: row.type,
          side: row.side,
          positionSide: row.position.side,
          triggerPrice: row.stopPrice,
          quantity: row.quantity,
          createTime: row.createdAt.toISOString(),
          symbol: group.symbol,
          strategyId: row.position.strategyId,
          strategyName: row.position.strategy.name,
          positionId: row.positionId,
          positionStatus: row.position.status,
          dbOrderId: row.id,
          apiConfigId: null,
        });
      }
    }

    this.logger.log(
      `checkOrphanOrders: orphans=${orphans.length} exchangeOpen=${exchangeOpen} pendingDb=${pendingDb}` +
        (strategyId ? ` strategy=${strategyId}` : ''),
    );

    return { orphans, exchangeOpen, pendingDb };
  }

  /** 条件单类型归一：TP / SL */
  private conditionalKind(type: string): 'tp' | 'sl' | 'other' {
    const t = (type || '').toLowerCase().replace(/_/g, '-');
    if (t.includes('take-profit') || t.includes('takeprofit') || t === 'tp') {
      return 'tp';
    }
    if (t.includes('stop')) return 'sl';
    return 'other';
  }

  /**
   * Lighter 历史 exchangeOrderId 常为 tx_hash，无法与 order_index 直接比；
   * 用类型+方向+触发价对齐（允许价格小数误差）。
   */
  conditionalOrdersMatch(
    localType: string,
    localSide: string,
    localStop: number | null | undefined,
    exType: string,
    exSide: string,
    exStop: number | null,
  ): boolean {
    if (this.conditionalKind(localType) !== this.conditionalKind(exType)) {
      return false;
    }
    if (localSide.toLowerCase() !== exSide.toLowerCase()) return false;
    if (localStop == null || exStop == null || !(exStop > 0) || !(localStop > 0)) {
      return false;
    }
    const diff = Math.abs(localStop - exStop);
    const tol = Math.max(0.05, localStop * 0.00005); // ≥5美分或 0.005%
    return diff <= tol;
  }

  /**
   * 在交易所挂单列表中找到与本地 PENDING 对应的单（ID 或 触发价特征）。
   * 若靠特征匹配且 ID 不同，写回真实 order_index。
   */
  async findAndHealOpenConditional(
    pending: {
      id: string;
      exchangeOrderId: string | null;
      type: string;
      side: string;
      stopPrice: number | null;
    },
    openOrders: OpenOrderInfo[],
    claimedExIds?: Set<string>,
  ): Promise<OpenOrderInfo | null> {
    if (!pending.exchangeOrderId && pending.stopPrice == null) return null;

    const available = claimedExIds
      ? openOrders.filter((o) => o.id && !claimedExIds.has(o.id))
      : openOrders;

    const byId = available.find(
      (o) =>
        !!pending.exchangeOrderId &&
        (o.id === pending.exchangeOrderId ||
          o.clientOrderId === pending.exchangeOrderId),
    );
    if (byId) {
      if (claimedExIds && byId.id) claimedExIds.add(byId.id);
      return byId;
    }

    const byFp = available.find((o) =>
      this.conditionalOrdersMatch(
        pending.type,
        pending.side,
        pending.stopPrice,
        o.type,
        o.side,
        o.stopPrice ?? null,
      ),
    );
    if (!byFp?.id) return null;

    if (claimedExIds) claimedExIds.add(byFp.id);

    if (pending.exchangeOrderId !== byFp.id) {
      try {
        await this.prisma.order.update({
          where: { id: pending.id },
          data: { exchangeOrderId: byFp.id },
        });
        this.logger.log(
          `Healed exchangeOrderId ${pending.id}: ${pending.exchangeOrderId} → ${byFp.id}`,
        );
      } catch (e) {
        this.logger.warn(
          `heal exchangeOrderId ${pending.id} failed: ${(e as Error).message}`,
        );
      }
    }
    return byFp;
  }

  /**
   * 清理孤儿条件单。可传 algoIds 只清指定项；否则清本次检查到的全部。
   */
  async cleanupOrphanOrders(
    strategyId?: string,
    algoIds?: string[],
  ): Promise<{
    attempted: number;
    succeeded: number;
    results: Array<{
      algoId: string;
      kind: OrphanKind;
      success: boolean;
      error?: string;
    }>;
  }> {
    const { orphans } = await this.checkOrphanOrders(strategyId);
    const filter =
      algoIds && algoIds.length > 0 ? new Set(algoIds.map(String)) : null;
    const targets = filter
      ? orphans.filter((o) => filter.has(o.algoId))
      : orphans;

    const results: Array<{
      algoId: string;
      kind: OrphanKind;
      success: boolean;
      error?: string;
    }> = [];

    // db_orphan 按 positionId 去重，一次 cancelPendingOrders 清掉该仓所有 PENDING
    const dbPositionsDone = new Set<string>();

    for (const orphan of targets) {
      try {
        if (orphan.kind === 'db_orphan') {
          if (!orphan.positionId) {
            results.push({
              algoId: orphan.algoId,
              kind: orphan.kind,
              success: false,
              error: 'missing positionId',
            });
            continue;
          }
          if (dbPositionsDone.has(orphan.positionId)) {
            results.push({
              algoId: orphan.algoId,
              kind: orphan.kind,
              success: true,
            });
            continue;
          }
          await this.cancelPendingOrders(orphan.positionId);
          dbPositionsDone.add(orphan.positionId);
          results.push({
            algoId: orphan.algoId,
            kind: orphan.kind,
            success: true,
          });
          continue;
        }

        // exchange_orphan：按挂单所属子账户撤（Lighter 多/空腿可能不同 apiConfig）
        const side = (orphan.positionSide === 'SHORT' ? 'SHORT' : 'LONG') as
          | 'LONG'
          | 'SHORT';
        const exchange = orphan.apiConfigId
          ? await this.exchangeService.getAdapterByApiConfigId(orphan.apiConfigId)
          : await this.exchangeService.getAdapterForStrategy(
              orphan.strategyId,
              side,
            );
        await this.exchangeService.cancelOrder(
          exchange,
          orphan.algoId,
          orphan.symbol,
        );
        if (orphan.dbOrderId) {
          await this.prisma.order.updateMany({
            where: { id: orphan.dbOrderId, status: OrderStatus.PENDING },
            data: { status: OrderStatus.CANCELED },
          });
        }
        results.push({
          algoId: orphan.algoId,
          kind: orphan.kind,
          success: true,
        });
      } catch (e) {
        const error = (e as Error).message;
        this.logger.warn(
          `cleanupOrphanOrders failed algoId=${orphan.algoId}: ${error}`,
        );
        results.push({
          algoId: orphan.algoId,
          kind: orphan.kind,
          success: false,
          error,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    this.logger.log(
      `cleanupOrphanOrders: succeeded=${succeeded}/${targets.length}` +
        (strategyId ? ` strategy=${strategyId}` : ''),
    );

    return { attempted: targets.length, succeeded, results };
  }

  /**
   * 解析扫描分组：按 long+short apiConfig + symbol 去重，每组用一个策略实例拉交易所。
   * Lighter 同多腿不同空腿的策略不能合并，否则会漏扫空腿子账户。
   */
  private async resolveOrphanScanGroups(strategyId?: string): Promise<
    Array<{
      strategyId: string;
      strategyName: string;
      symbol: string;
      apiConfigId: string | null;
      shortApiConfigId: string | null;
    }>
  > {
    const select = {
      id: true,
      name: true,
      symbol: true,
      apiConfigId: true,
      shortApiConfigId: true,
    } as const;

    if (strategyId) {
      const s = await this.prisma.strategy.findUnique({
        where: { id: strategyId },
        select,
      });
      if (!s) {
        throw new NotFoundException(`Strategy ${strategyId} not found`);
      }
      return [
        {
          strategyId: s.id,
          strategyName: s.name,
          symbol: s.symbol,
          apiConfigId: s.apiConfigId,
          shortApiConfigId: s.shortApiConfigId,
        },
      ];
    }

    const strategies = await this.prisma.strategy.findMany({
      where: { isActive: true },
      select,
      orderBy: { createdAt: 'asc' },
    });

    // 无活跃策略时退回全部策略（至少能按账户扫）
    const pool =
      strategies.length > 0
        ? strategies
        : await this.prisma.strategy.findMany({
            select,
            orderBy: { createdAt: 'asc' },
          });

    const seen = new Set<string>();
    const groups: Array<{
      strategyId: string;
      strategyName: string;
      symbol: string;
      apiConfigId: string | null;
      shortApiConfigId: string | null;
    }> = [];

    for (const s of pool) {
      const key = `${s.apiConfigId ?? 'null'}::${s.shortApiConfigId ?? 'null'}::${s.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({
        strategyId: s.id,
        strategyName: s.name,
        symbol: s.symbol,
        apiConfigId: s.apiConfigId,
        shortApiConfigId: s.shortApiConfigId,
      });
    }
    return groups;
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
