/**
 * AccountV2 — 单账户多空双开
 *
 * 管理一个账户，同时持有多单 lots 和空单 lots。
 * 每个 lot 是独立的小仓位，有各自的开仓价、数量和保证金。
 * 逐仓止盈止损：检查每个 lot 是否达到止盈或止损条件，只平掉触发的 lot。
 */

import type { Lot } from '../types.js';

export class AccountV2 {
  balance: number;
  longLots: Lot[] = [];
  shortLots: Lot[] = [];

  constructor(initialBalance: number) {
    this.balance = initialBalance;
  }

  /** 计算带杠杆的仓位价值 */
  private calcPositionValue(margin: number, leverage: number): number {
    return margin * leverage;
  }

  /** 同时在当前价格开一个多单 lot 和一个空单 lot */
  openBoth(price: number, marginPerSide: number, leverage: number, feeRate: number, slPct: number, tpPct: number): void {
    const posValue = this.calcPositionValue(marginPerSide, leverage);
    const qty = posValue / price;
    const fee = posValue * feeRate;

    this.balance -= marginPerSide * 2 + fee * 2; // 扣除保证金 + 手续费
    const slPriceLong = price * (1 - slPct);
    const tpPriceLong = price * (1 + tpPct);
    const slPriceShort = price * (1 + slPct);
    const tpPriceShort = price * (1 - tpPct);
    this.longLots.push({ side: 'long', entryPrice: price, quantity: qty, margin: marginPerSide, slPrice: slPriceLong, tpPrice: tpPriceLong });
    this.shortLots.push({ side: 'short', entryPrice: price, quantity: qty, margin: marginPerSide, slPrice: slPriceShort, tpPrice: tpPriceShort });
  }

  openLong(price: number, marginPerSide: number, leverage: number, feeRate: number, slPct: number, tpPct: number): void {
    const posValue = this.calcPositionValue(marginPerSide, leverage);
    const qty = posValue / price;
    const fee = posValue * feeRate;
    this.balance -= marginPerSide + fee;
    this.longLots.push({ side: 'long', entryPrice: price, quantity: qty, margin: marginPerSide, slPrice: price * (1 - slPct), tpPrice: price * (1 + tpPct) });
  }

  openShort(price: number, marginPerSide: number, leverage: number, feeRate: number, slPct: number, tpPct: number): void {
    const posValue = this.calcPositionValue(marginPerSide, leverage);
    const qty = posValue / price;
    const fee = posValue * feeRate;
    this.balance -= marginPerSide + fee;
    this.shortLots.push({ side: 'short', entryPrice: price, quantity: qty, margin: marginPerSide, slPrice: price * (1 + slPct), tpPrice: price * (1 - tpPct) });
  }

  /**
   * 检查并平掉达到止盈或止损条件的 lots
   * 返回被平掉的列表，含 reason: 'sl'(止损) 或 'tp'(止盈)
   */
  checkCloseConditions(
    prevHigh: number,
    prevLow: number,
    feeRate: number,
  ): { side: string; entryPrice: number; closePrice: number; pnl: number; fee: number; reason: 'sl' | 'tp' }[] {
    const closed: { side: string; entryPrice: number; closePrice: number; pnl: number; fee: number; reason: 'sl' | 'tp' }[] = [];

    const closeLong = (lot: Lot, price: number, reason: 'sl' | 'tp') => {
      const pnl = (price - lot.entryPrice) * lot.quantity;
      const fee = price * lot.quantity * feeRate;
      this.balance += lot.margin + pnl - fee;
      closed.push({ side: 'long', entryPrice: lot.entryPrice, closePrice: price, pnl: Math.round(pnl * 100) / 100, fee: Math.round(fee * 100) / 100, reason });
    };

    const closeShort = (lot: Lot, price: number, reason: 'sl' | 'tp') => {
      const pnl = (lot.entryPrice - price) * lot.quantity;
      const fee = price * lot.quantity * feeRate;
      this.balance += lot.margin + pnl - fee;
      closed.push({ side: 'short', entryPrice: lot.entryPrice, closePrice: price, pnl: Math.round(pnl * 100) / 100, fee: Math.round(fee * 100) / 100, reason });
    };

    // 检查多单
    const remainingLong: Lot[] = [];
    for (const lot of this.longLots) {
      if (prevLow <= lot.slPrice) {
        closeLong(lot, lot.slPrice, 'sl');
      } else if (prevHigh >= lot.tpPrice) {
        closeLong(lot, lot.tpPrice, 'tp');
      } else {
        remainingLong.push(lot);
      }
    }
    this.longLots = remainingLong;

    // 检查空单
    const remainingShort: Lot[] = [];
    for (const lot of this.shortLots) {
      if (prevHigh >= lot.slPrice) {
        closeShort(lot, lot.slPrice, 'sl');
      } else if (prevLow <= lot.tpPrice) {
        closeShort(lot, lot.tpPrice, 'tp');
      } else {
        remainingShort.push(lot);
      }
    }
    this.shortLots = remainingShort;

    return closed;
  }

  /** 获取所有 lots 的总浮动盈亏 */
  getUnrealizedPnL(currentPrice: number): number {
    let pnl = 0;
    for (const lot of this.longLots) {
      pnl += (currentPrice - lot.entryPrice) * lot.quantity;
    }
    for (const lot of this.shortLots) {
      pnl += (lot.entryPrice - currentPrice) * lot.quantity;
    }
    return pnl;
  }

  /** 多单浮动盈亏 */
  getLongPnL(currentPrice: number): number {
    let pnl = 0;
    for (const lot of this.longLots) {
      pnl += (currentPrice - lot.entryPrice) * lot.quantity;
    }
    return pnl;
  }

  /** 空单浮动盈亏 */
  getShortPnL(currentPrice: number): number {
    let pnl = 0;
    for (const lot of this.shortLots) {
      pnl += (lot.entryPrice - currentPrice) * lot.quantity;
    }
    return pnl;
  }

  /** 账户净值 = 可用余额 + 锁定保证金 + 浮动盈亏 */
  getEquity(currentPrice: number): number {
    return this.balance + this.totalMargin + this.getUnrealizedPnL(currentPrice);
  }

  /** 总占用保证金 */
  get totalMargin(): number {
    let m = 0;
    for (const lot of this.longLots) m += lot.margin;
    for (const lot of this.shortLots) m += lot.margin;
    return m;
  }
}
