/**
 * 虚拟账户模块
 * 管理一个独立账户的资金、持仓、盈亏计算和止损检测
 *
 * 记账模型：
 *   balance    = 现金余额（随手续费和已实现盈亏变化）
 *   position   = 当前持仓
 *   equity     = balance + 未实现盈亏（账户实际净值）
 */

import { config } from '../config.js';
import type { Position, PositionSide, AccountSnapshot } from '../types.js';

export class Account {
  readonly name: string;
  readonly side: PositionSide;
  /** 现金余额（扣除手续费，加入已实现盈亏） */
  balance: number;
  position: Position | null = null;
  /** 账户是否刚被止损平仓，等待下一小时重开 */
  isStopped = false;

  constructor(name: string, side: PositionSide, initialBalance: number) {
    this.name = name;
    this.side = side;
    this.balance = initialBalance;
  }

  /** 可用的保证金金额 = 余额 × 保证金比例 */
  get availableMargin(): number {
    return this.balance * config.marginRatio;
  }

  /** 计算开仓时的仓位价值（考虑杠杆） */
  private calcPositionValue(margin: number): number {
    return margin * config.leverage;
  }

  /** 开仓 —— 以指定价格开仓，用保证金比例计算仓位 */
  openPosition(price: number, marginOverride?: number): void {
    const margin = marginOverride ?? this.availableMargin;
    const positionValue = this.calcPositionValue(margin);
    const quantity = positionValue / price;

    this.position = {
      side: this.side,
      quantity,
      averageEntryPrice: price,
      latestEntryPrice: price,
    };

    // 扣除开仓手续费（基于仓位价值）
    const fee = positionValue * config.feeRate;
    this.balance -= fee;

    this.isStopped = false;
    console.log(
      `[${this.name}] 开${this.side === 'long' ? '多' : '空'} @ ${price.toFixed(2)}, ` +
      `保证金 ${margin.toFixed(2)} (${config.leverage}x), 数量 ${quantity.toFixed(6)}, 手续费 ${fee.toFixed(4)}`
    );
  }

  /** 加仓 —— 追加指定金额的保证金，更新均价和最新加仓价 */
  addToPosition(price: number, additionalUsd: number): void {
    if (!this.position) {
      // 如果没有持仓，将追加金额计入余额后开仓
      this.balance += additionalUsd;
      this.openPosition(price);
      return;
    }

    const additionalPosValue = this.calcPositionValue(additionalUsd);
    const additionalQty = additionalPosValue / price;

    const oldQty = this.position.quantity;
    const oldAvg = this.position.averageEntryPrice;
    const newQty = oldQty + additionalQty;
    const newAvg = (oldAvg * oldQty + price * additionalQty) / newQty;

    this.position = {
      side: this.side,
      quantity: newQty,
      averageEntryPrice: newAvg,
      latestEntryPrice: price,
    };

    // 扣除开仓手续费
    const fee = additionalPosValue * config.feeRate;
    this.balance -= fee;

    console.log(
      `[${this.name}] 加仓 @ ${price.toFixed(2)}, +${additionalUsd.toFixed(2)} USD 保证金, ` +
      `新数量 ${newQty.toFixed(6)}, 新均价 ${newAvg.toFixed(2)}, 手续费 ${fee.toFixed(4)}`
    );
  }

  /** 减仓 —— 按亏损金额减少仓位 */
  reducePosition(price: number, reduceUsd: number): void {
    if (!this.position) return;

    const reducePosValue = this.calcPositionValue(Math.abs(reduceUsd));
    const reduceQty = Math.min(reducePosValue / price, this.position.quantity);

    if (reduceQty <= 0) return;

    // 计算减仓部分的已实现盈亏
    const costBasis = this.position.averageEntryPrice * reduceQty;
    const posValue = price * reduceQty;
    let realizedPnl: number;
    if (this.side === 'long') {
      realizedPnl = posValue - costBasis;
    } else {
      realizedPnl = costBasis - posValue;
    }

    // 扣除手续费
    const fee = posValue * config.feeRate;

    // 已实现盈亏入账
    this.balance += realizedPnl - fee;

    // 更新持仓
    const newQty = this.position.quantity - reduceQty;
    if (newQty < 0.000001) {
      this.position = null;
    } else {
      this.position = { ...this.position, quantity: newQty };
    }

    console.log(
      `[${this.name}] 减仓 @ ${price.toFixed(2)}, -${Math.abs(reduceUsd).toFixed(2)} USD, ` +
      `数量 -${reduceQty.toFixed(6)}, 已实现盈亏 ${realizedPnl.toFixed(2)}, 手续费 ${fee.toFixed(4)}`
    );
  }

  /** 平仓全部持仓，返回平仓后现金余额 */
  closePosition(price: number): number {
    if (!this.position) return this.balance;

    const positionValue = this.position.quantity * price;
    const costBasis = this.position.quantity * this.position.averageEntryPrice;

    // 计算已实现盈亏
    let pnl: number;
    if (this.side === 'long') {
      pnl = positionValue - costBasis;
    } else {
      pnl = costBasis - positionValue;
    }

    // 扣除平仓手续费
    const fee = positionValue * config.feeRate;

    // 平仓后：已实现盈亏入账 - 手续费
    this.balance += pnl - fee;
    this.position = null;

    console.log(
      `[${this.name}] 平仓 @ ${price.toFixed(2)}, PnL ${pnl.toFixed(2)}, ` +
      `手续费 ${fee.toFixed(4)}, 余额 ${this.balance.toFixed(2)}`
    );

    return this.balance;
  }

  /** 获取未实现盈亏 */
  getUnrealizedPnL(currentPrice: number): number {
    if (!this.position) return 0;
    const positionValue = this.position.quantity * currentPrice;
    const costBasis = this.position.quantity * this.position.averageEntryPrice;
    if (this.side === 'long') {
      return positionValue - costBasis;
    } else {
      return costBasis - positionValue;
    }
  }

  /** 账户净值 = 现金余额 + 未实现盈亏 */
  getEquity(currentPrice: number): number {
    return this.balance + this.getUnrealizedPnL(currentPrice);
  }

  /** 从最近加仓/开仓价的亏损百分比（正数表示亏损比例） */
  getLossPercent(currentPrice: number): number {
    if (!this.position) return 0;
    const entry = this.position.latestEntryPrice;
    if (entry === 0) return 0;
    if (this.side === 'long') {
      return Math.max(0, (entry - currentPrice) / entry);
    } else {
      return Math.max(0, (currentPrice - entry) / entry);
    }
  }

  /** 是否需要止损 */
  shouldStop(currentPrice: number): boolean {
    return this.getLossPercent(currentPrice) >= config.stopLossPercent;
  }

  /** 抓取快照（用于推送） */
  snapshot(currentPrice: number): AccountSnapshot {
    return {
      name: this.name,
      side: this.side,
      balance: this.balance,
      equity: this.getEquity(currentPrice),
      position: this.position ? { ...this.position } : null,
      unrealizedPnL: this.getUnrealizedPnL(currentPrice),
      lossPercent: this.getLossPercent(currentPrice),
      isStopped: this.isStopped,
    };
  }
}
