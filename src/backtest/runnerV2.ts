/**
 * runnerV2 — 步骤式回测状态机
 *
 * 单账户多空双开，每步：
 *   1. 在当前 K 线开盘价同时开一个多单 lot + 一个空单 lot
 *   2. 用上一根 K 线的 high/low 检查所有已有 lots 是否触发止损
 *   3. 触损的 lot 逐个平掉
 *   4. 记录快照
 */

import { AccountV2 } from '../account/AccountV2.js';
import { config } from '../config.js';
import type { Candle, Lot, V2BacktestParams, V2BacktestSnapshot, V2BacktestState, AllLotRecord } from '../types.js';

const FEE_RATE = 0.0002;
const MAX_SNAPSHOTS = 2000;

const INITIAL_BALANCE = 1000;

/** 根据 K 线周期计算每天有几根 */
function candlesPerDay(interval: string): number {
  const map: Record<string, number> = {
    '1m': 1440, '3m': 480, '5m': 288, '15m': 96, '30m': 48,
    '1h': 24, '2h': 12, '4h': 6, '6h': 4, '8h': 3, '12h': 2, '1d': 1,
  };
  return map[interval] || 24;
}

/** 从 Binance REST 获取历史 K 线 */
async function fetchCandles(symbol: string, days: number, interval: string): Promise<Candle[]> {
  const cpd = candlesPerDay(interval);
  const limit = Math.min(days * cpd, 1500);
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json() as unknown[][];

  let allCandles: Candle[] = data.map(k => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));

  const needed = days * cpd;
  while (allCandles.length < needed && allCandles.length >= 1500) {
    const earliest = allCandles[0].openTime;
    const url2 = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=1500&endTime=${earliest - 1}`;
    const res2 = await fetch(url2);
    if (!res2.ok) break;
    const data2 = await res2.json() as unknown[][];
    if (data2.length === 0) break;
    const more: Candle[] = data2.map(k => ({
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }));
    allCandles = [...more, ...allCandles];
    if (more.length < 1500) break;
  }

  if (allCandles.length > needed) {
    allCandles = allCandles.slice(allCandles.length - needed);
  }
  return allCandles;
}

/** 创建快照 */
function makeSnapshot(
  hour: number,
  candle: Candle,
  account: AccountV2,
  stoppedLots: V2BacktestSnapshot['stoppedLots'],
  action: string,
  initialBalance: number,
): V2BacktestSnapshot {
  const equity = account.getEquity(candle.open);
  const unrealizedPnL = account.getUnrealizedPnL(candle.open);
  return {
    hour,
    timestamp: candle.openTime,
    openPrice: candle.open,
    equity: Math.round(equity * 100) / 100,
    balance: Math.round(account.balance * 100) / 100,
    unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
    longPnL: Math.round(account.getLongPnL(candle.open) * 100) / 100,
    shortPnL: Math.round(account.getShortPnL(candle.open) * 100) / 100,
    totalReturnPct: Math.round(((equity - initialBalance) / initialBalance) * 10000) / 100,
    longLots: account.longLots.map(l => ({ ...l })),
    shortLots: account.shortLots.map(l => ({ ...l })),
    stoppedLots,
    action,
  };
}

/** 初始化回测：拉取 K 线，返回初始 state（尚未处理任何 K 线） */
export async function initBacktest(params: V2BacktestParams): Promise<V2BacktestState> {
  const candles = await fetchCandles(params.symbol, params.days, params.interval);
  if (candles.length < 1) {
    throw new Error(`获取到 ${candles.length} 根 K 线`);
  }

  return {
    symbol: params.symbol,
    initialBalance: params.initialBalance,
    params: {
      interval: params.interval,
      leverage: params.leverage,
      marginRatio: params.marginRatio,
      stopLossPercent: params.stopLossPercent,
      takeProfitPercent: params.takeProfitPercent,
      positionAmountValue: params.positionAmountValue,
      direction: params.direction || 'both',
    },
    candles,
    currentIndex: 0,
    balance: params.initialBalance,
    longLots: [],
    shortLots: [],
    snapshots: [],
    totalFee: 0,
    totalOpenCount: 0,
    allLots: [],
    done: false,
  };
}

/** 前进一根 K 线，返回新的 state */
export function stepBacktest(state: V2BacktestState): V2BacktestState {
  if (state.done || state.currentIndex >= state.candles.length) {
    return { ...state, done: true };
  }

  const candle = state.candles[state.currentIndex];
  const price = candle.open;

  // 重建账户
  const account = new AccountV2(state.balance);
  account.longLots = state.longLots.map(l => ({ ...l }));
  account.shortLots = state.shortLots.map(l => ({ ...l }));

  // 止盈止损检查（用前一根 K 线）— 先检查再开仓，避免新开单被提前平掉
  const actionParts: string[] = [];
  let stoppedLots: V2BacktestSnapshot['stoppedLots'] = [];
  if (state.currentIndex > 0) {
    const prev = state.candles[state.currentIndex - 1];
    stoppedLots = account.checkCloseConditions(
      prev.high, prev.low,
      FEE_RATE,
    );
    if (stoppedLots.length > 0) {
      const slCount = stoppedLots.filter(l => l.reason === 'sl').length;
      const tpCount = stoppedLots.filter(l => l.reason === 'tp').length;
      if (slCount > 0) actionParts.push(`止损${slCount}单`);
      if (tpCount > 0) actionParts.push(`止盈${tpCount}单`);
    }
  }
  // 累计平仓手续费
  const closeFee = stoppedLots.reduce((sum, l) => sum + l.fee, 0);

  // 开仓 — 根据 direction 决定方向
  const marginPerSide = state.params.positionAmountValue;
  const equity = account.getEquity(price);
  const availableFunds = account.balance + account.getUnrealizedPnL(price);
  const dir = state.params.direction || 'both';
  const sides = dir === 'both' ? 2 : 1;
  let openFee = 0;
  let didOpen = false;
  if (equity > 0 && availableFunds >= marginPerSide * sides) {
    const posValue = marginPerSide * state.params.leverage;
    const qty = posValue / price;
    const now = candle.openTime;

    if (dir === 'both' || dir === 'long') {
      actionParts.push('开多');
      account.openLong(price, marginPerSide, state.params.leverage, FEE_RATE, state.params.stopLossPercent, state.params.takeProfitPercent);
      openFee += posValue * FEE_RATE;
      state.allLots.push({ side:'long', entryPrice:price, slPrice:price*(1-state.params.stopLossPercent), tpPrice:price*(1+state.params.takeProfitPercent), quantity:qty, margin:marginPerSide, openTime:now, status:'open' });
    }
    if (dir === 'both' || dir === 'short') {
      actionParts.push('开空');
      account.openShort(price, marginPerSide, state.params.leverage, FEE_RATE, state.params.stopLossPercent, state.params.takeProfitPercent);
      openFee += posValue * FEE_RATE;
      state.allLots.push({ side:'short', entryPrice:price, slPrice:price*(1+state.params.stopLossPercent), tpPrice:price*(1-state.params.takeProfitPercent), quantity:qty, margin:marginPerSide, openTime:now, status:'open' });
    }
    didOpen = true;
  } else {
    actionParts.push('权益不足');
  }

  const action = actionParts.join(' ');
  const snapshot = makeSnapshot(state.currentIndex, candle, account, stoppedLots, action, state.initialBalance);
  const nextIndex = state.currentIndex + 1;

  return {
    ...state,
    currentIndex: nextIndex,
    balance: account.balance,
    longLots: account.longLots,
    shortLots: account.shortLots,
    snapshots: [...state.snapshots, snapshot].slice(-MAX_SNAPSHOTS),
    totalFee: state.totalFee + openFee + closeFee,
    totalOpenCount: state.totalOpenCount + (didOpen ? 1 : 0),
    done: nextIndex >= state.candles.length,
  };
}

/** 一次跑完所有剩余 K 线 */
export function runAllBacktest(state: V2BacktestState): V2BacktestState {
  let s = state;
  while (!s.done) {
    s = stepBacktest(s);
  }
  return s;
}
