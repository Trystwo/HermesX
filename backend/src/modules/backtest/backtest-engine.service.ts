/**
 * 回测引擎
 * 按周期同时开多+开空，独立 TP/SL，平仓量精确等于开仓量 Q
 * 严禁调用真实下单接口 —— 仅基于历史 K 线内存模拟
 *
 * 净值曲线：equity = initialBalance - cumulativeFees + realizedGross + unrealizedMtm
 * 开仓门禁：available = equity - usedMargin；须覆盖本周期 requiredMargin
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_INITIAL_BALANCE,
  MAX_EQUITY_CURVE_POINTS,
} from './backtest.constants';
import { calcCloseFee, calcOpenFee } from './fee-calculator';
import { applySlippage } from './slippage-calculator';
import type {
  BacktestEngineInput,
  BacktestEngineOutput,
  BacktestStats,
  BacktestTradeDetail,
  EquityCurvePoint,
} from './backtest.types';

/** 保证金缓冲系数（与实盘 RiskService 一致） */
const MARGIN_BUFFER = 1.2;
/** 每周期开多+空 */
const HEDGE_LEGS = 2;

interface OpenSimPosition {
  cycleId: string;
  side: 'LONG' | 'SHORT';
  openTime: number;
  openAssumedPrice: number;
  openFillPrice: number;
  quantity: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  openFee: number;
  openSlippageCost: number;
}

@Injectable()
export class BacktestEngineService {
  private readonly logger = new Logger(BacktestEngineService.name);

  /**
   * 对给定 K 线序列执行策略回放
   */
  run(input: BacktestEngineInput): BacktestEngineOutput {
    const { params, fee, slippage, klines } = input;
    const initialBalance =
      input.initialBalance > 0 ? input.initialBalance : DEFAULT_INITIAL_BALANCE;

    if (!klines.length) {
      return { stats: this.emptyStats(), trades: [], equityCurve: [] };
    }

    const trades: BacktestTradeDetail[] = [];
    const openPositions: OpenSimPosition[] = [];
    const rawCurve: EquityCurvePoint[] = [];

    let cumulativeFees = 0;
    let realizedGross = 0;
    let realizedNet = 0;

    for (let i = 0; i < klines.length; i++) {
      const bar = klines[i];
      const tradesBefore = trades.length;

      // 1) 先检查已有仓位是否在本根 K 线触发 TP/SL（不含本根新开仓）
      this.checkExits(openPositions, bar, fee, slippage, trades);

      // 平仓：累加已实现盈亏与平仓手续费（开仓费已在开仓时计入）
      for (let j = tradesBefore; j < trades.length; j++) {
        const t = trades[j];
        realizedGross += t.grossPnl;
        realizedNet += t.netPnl;
        cumulativeFees += t.closeFee;
      }

      // 2) 本根 K 线作为新周期：若未达 maxPositions 且保证金充足，双边开仓
      if (openPositions.length + 2 <= params.maxPositions) {
        const qty = this.calcQuantity(params.quantity, params.quantityType, bar.open);
        if (qty > 0) {
          const leverage = params.leverage > 0 ? params.leverage : 1;
          const sideNotional = this.calcSideNotional(
            params.quantity,
            params.quantityType,
            qty,
            bar.open,
          );
          const requiredMargin =
            ((sideNotional * HEDGE_LEGS) / leverage) * MARGIN_BUFFER;
          const unrealized = this.calcUnrealized(openPositions, bar.open);
          const equity =
            initialBalance - cumulativeFees + realizedGross + unrealized;
          const usedMargin = this.calcUsedMargin(openPositions, leverage);
          const available = equity - usedMargin;

          if (available < requiredMargin) {
            this.logger.debug(
              `Skip open: available=${available.toFixed(4)} < required=${requiredMargin.toFixed(4)} ` +
                `(equity=${equity.toFixed(4)}, usedMargin=${usedMargin.toFixed(4)})`,
            );
          } else {
            const cycleId = `${params.cycleInterval}:${new Date(bar.timestamp).toISOString().slice(0, 16)}`;
            const longPos = this.openOne(
              'LONG',
              cycleId,
              bar.timestamp,
              bar.open,
              qty,
              params,
              fee,
              slippage,
            );
            const shortPos = this.openOne(
              'SHORT',
              cycleId,
              bar.timestamp,
              bar.open,
              qty,
              params,
              fee,
              slippage,
            );
            openPositions.push(longPos, shortPos);
            cumulativeFees += longPos.openFee + shortPos.openFee;

            // 开仓当根也可能触及 TP/SL（按 open 开仓后，用本根 high/low 判定）
            const tradesAfterOpen = trades.length;
            this.checkExits(openPositions, bar, fee, slippage, trades);
            for (let j = tradesAfterOpen; j < trades.length; j++) {
              const t = trades[j];
              realizedGross += t.grossPnl;
              realizedNet += t.netPnl;
              cumulativeFees += t.closeFee;
            }
          }
        }
      }

      // 3) 本 bar 收盘盯市采样
      rawCurve.push(
        this.snapshotEquity(
          bar.timestamp,
          initialBalance,
          cumulativeFees,
          realizedGross,
          realizedNet,
          openPositions,
          bar.close,
        ),
      );
    }

    // 4) 区间结束强制平仓（EOD），按最后一根收盘价
    const last = klines[klines.length - 1];
    while (openPositions.length > 0) {
      const pos = openPositions.shift()!;
      const t = this.closePosition(pos, last.timestamp, last.close, 'EOD', fee, slippage);
      trades.push(t);
      realizedGross += t.grossPnl;
      realizedNet += t.netPnl;
      cumulativeFees += t.closeFee;
    }

    // EOD 后补一个终值点（无持仓）
    rawCurve.push(
      this.snapshotEquity(
        last.timestamp,
        initialBalance,
        cumulativeFees,
        realizedGross,
        realizedNet,
        [],
        last.close,
      ),
    );

    const equityCurve = this.downsampleCurve(rawCurve, MAX_EQUITY_CURVE_POINTS);
    const stats = this.computeStats(trades);
    this.logger.debug(
      `Backtest done: ${input.symbol} trades=${stats.totalTrades} pnl=${stats.totalPnl.toFixed(4)} curve=${equityCurve.length}`,
    );
    return { stats, trades, equityCurve };
  }

  private snapshotEquity(
    t: number,
    initialBalance: number,
    cumulativeFees: number,
    realizedGross: number,
    realizedNet: number,
    openPositions: OpenSimPosition[],
    markPrice: number,
  ): EquityCurvePoint {
    const unrealized = this.calcUnrealized(openPositions, markPrice);
    const equity = initialBalance - cumulativeFees + realizedGross + unrealized;
    return {
      t,
      equity: this.round(equity),
      realizedNet: this.round(realizedNet),
      fees: this.round(cumulativeFees),
      unrealized: this.round(unrealized),
      openCount: openPositions.length,
    };
  }

  private calcUnrealized(
    openPositions: OpenSimPosition[],
    markPrice: number,
  ): number {
    let unrealized = 0;
    for (const pos of openPositions) {
      unrealized +=
        pos.side === 'LONG'
          ? (markPrice - pos.openFillPrice) * pos.quantity
          : (pos.openFillPrice - markPrice) * pos.quantity;
    }
    return unrealized;
  }

  /** 单边名义本金 */
  private calcSideNotional(
    quantity: number,
    quantityType: 'BY_QUANTITY' | 'BY_NOTIONAL',
    qty: number,
    price: number,
  ): number {
    if (quantityType === 'BY_NOTIONAL') return quantity;
    return qty * price;
  }

  /** 已占用保证金 = Σ(持仓名义 / leverage)，不含 buffer */
  private calcUsedMargin(
    openPositions: OpenSimPosition[],
    leverage: number,
  ): number {
    let used = 0;
    for (const pos of openPositions) {
      used += (pos.quantity * pos.openFillPrice) / leverage;
    }
    return used;
  }

  /**
   * 均匀降采样，首尾必留，保证可复现
   */
  private downsampleCurve(
    points: EquityCurvePoint[],
    maxPoints: number,
  ): EquityCurvePoint[] {
    if (points.length <= maxPoints) return points;
    const result: EquityCurvePoint[] = [];
    const last = points.length - 1;
    for (let i = 0; i < maxPoints; i++) {
      const idx =
        i === maxPoints - 1 ? last : Math.round((i * last) / (maxPoints - 1));
      const p = points[idx];
      if (result.length === 0 || result[result.length - 1].t !== p.t) {
        result.push(p);
      }
    }
    return result;
  }

  private openOne(
    side: 'LONG' | 'SHORT',
    cycleId: string,
    openTime: number,
    assumedPrice: number,
    quantity: number,
    params: BacktestEngineInput['params'],
    fee: BacktestEngineInput['fee'],
    slippage: BacktestEngineInput['slippage'],
  ): OpenSimPosition {
    const slip = applySlippage(assumedPrice, quantity, side, 'OPEN', slippage);
    const openFee = calcOpenFee(slip.fillPrice, quantity, fee);

    const takeProfitPrice =
      side === 'LONG'
        ? assumedPrice * (1 + params.takeProfitPct / 100)
        : assumedPrice * (1 - params.takeProfitPct / 100);
    const stopLossPrice =
      side === 'LONG'
        ? assumedPrice * (1 - params.stopLossPct / 100)
        : assumedPrice * (1 + params.stopLossPct / 100);

    return {
      cycleId,
      side,
      openTime,
      openAssumedPrice: assumedPrice,
      openFillPrice: slip.fillPrice,
      quantity,
      takeProfitPrice,
      stopLossPrice,
      openFee,
      openSlippageCost: slip.slippageCost,
    };
  }

  /**
   * 检查本根 K 线是否触及 TP/SL（含开仓当根：按 open 入场后用 high/low 判定）
   * 同根同时触及时取保守假设：优先止损（避免收益虚高）
   */
  private checkExits(
    openPositions: OpenSimPosition[],
    bar: { timestamp: number; high: number; low: number },
    fee: BacktestEngineInput['fee'],
    slippage: BacktestEngineInput['slippage'],
    trades: BacktestTradeDetail[],
  ): void {
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      // 仅跳过未来仓位；开仓当根（timestamp === openTime）允许判定
      if (bar.timestamp < pos.openTime) continue;

      let exitReason: 'TP' | 'SL' | null = null;
      let triggerPrice = 0;

      const hitSl =
        pos.side === 'LONG'
          ? bar.low <= pos.stopLossPrice
          : bar.high >= pos.stopLossPrice;
      const hitTp =
        pos.side === 'LONG'
          ? bar.high >= pos.takeProfitPrice
          : bar.low <= pos.takeProfitPrice;

      if (hitSl && hitTp) {
        exitReason = 'SL';
        triggerPrice = pos.stopLossPrice;
      } else if (hitSl) {
        exitReason = 'SL';
        triggerPrice = pos.stopLossPrice;
      } else if (hitTp) {
        exitReason = 'TP';
        triggerPrice = pos.takeProfitPrice;
      }

      if (exitReason) {
        trades.push(
          this.closePosition(pos, bar.timestamp, triggerPrice, exitReason, fee, slippage),
        );
        openPositions.splice(i, 1);
      }
    }
  }

  private closePosition(
    pos: OpenSimPosition,
    closeTime: number,
    assumedClosePrice: number,
    exitReason: 'TP' | 'SL' | 'EOD',
    fee: BacktestEngineInput['fee'],
    slippage: BacktestEngineInput['slippage'],
  ): BacktestTradeDetail {
    const slip = applySlippage(
      assumedClosePrice,
      pos.quantity,
      pos.side,
      'CLOSE',
      slippage,
    );
    const closeFee = calcCloseFee(slip.fillPrice, pos.quantity, fee);
    const totalFee = pos.openFee + closeFee;
    const totalSlippageCost = pos.openSlippageCost + slip.slippageCost;

    const grossPnl =
      pos.side === 'LONG'
        ? (slip.fillPrice - pos.openFillPrice) * pos.quantity
        : (pos.openFillPrice - slip.fillPrice) * pos.quantity;

    const netPnl = grossPnl - totalFee;

    return {
      cycleId: pos.cycleId,
      side: pos.side,
      openTime: pos.openTime,
      closeTime,
      openAssumedPrice: pos.openAssumedPrice,
      openFillPrice: pos.openFillPrice,
      closeAssumedPrice: assumedClosePrice,
      closeFillPrice: slip.fillPrice,
      quantity: pos.quantity,
      grossPnl,
      openFee: pos.openFee,
      closeFee,
      totalFee,
      openSlippageCost: pos.openSlippageCost,
      closeSlippageCost: slip.slippageCost,
      totalSlippageCost,
      netPnl,
      exitReason,
      takeProfitPrice: pos.takeProfitPrice,
      stopLossPrice: pos.stopLossPrice,
    };
  }

  private calcQuantity(
    quantity: number,
    quantityType: 'BY_QUANTITY' | 'BY_NOTIONAL',
    price: number,
  ): number {
    if (quantityType === 'BY_QUANTITY') return quantity;
    if (price <= 0) return 0;
    const qty = quantity / price;
    return Math.floor(qty * 1_000_000) / 1_000_000;
  }

  private computeStats(trades: BacktestTradeDetail[]): BacktestStats {
    if (trades.length === 0) return this.emptyStats();

    let totalPnl = 0;
    let grossPnl = 0;
    let totalFee = 0;
    let totalSlippageCost = 0;
    let winTrades = 0;
    let lossTrades = 0;
    let sumWin = 0;
    let sumLoss = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let equity = 0;

    const sorted = [...trades].sort((a, b) => a.closeTime - b.closeTime || a.openTime - b.openTime);

    for (const t of sorted) {
      totalPnl += t.netPnl;
      grossPnl += t.grossPnl;
      totalFee += t.totalFee;
      totalSlippageCost += t.totalSlippageCost;
      equity += t.netPnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (t.netPnl > 0) {
        winTrades += 1;
        sumWin += t.netPnl;
      } else if (t.netPnl < 0) {
        lossTrades += 1;
        sumLoss += Math.abs(t.netPnl);
      }
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
    const avgWin = winTrades > 0 ? sumWin / winTrades : 0;
    const avgLoss = lossTrades > 0 ? sumLoss / lossTrades : 0;
    const profitFactor = sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? Infinity : 0;
    const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    return {
      totalPnl: this.round(totalPnl),
      winRate: this.round(winRate),
      maxDrawdown: this.round(maxDrawdown),
      maxDrawdownPct: this.round(maxDrawdownPct),
      profitFactor: profitFactor === Infinity ? 999 : this.round(profitFactor),
      totalTrades,
      winTrades,
      lossTrades,
      avgWin: this.round(avgWin),
      avgLoss: this.round(avgLoss),
      totalFee: this.round(totalFee),
      totalSlippageCost: this.round(totalSlippageCost),
      grossPnl: this.round(grossPnl),
    };
  }

  private emptyStats(): BacktestStats {
    return {
      totalPnl: 0,
      winRate: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      totalFee: 0,
      totalSlippageCost: 0,
      grossPnl: 0,
    };
  }

  private round(n: number): number {
    return Math.round(n * 1e6) / 1e6;
  }
}
