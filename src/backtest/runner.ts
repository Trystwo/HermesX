/**
 * 回测运行器
 * 从 Binance REST API 拉取历史 1h K 线，逐根运行策略逻辑，返回结果
 */

import { Account } from '../account/Account.js';
import { config } from '../config.js';
import type { Candle } from '../types.js';

export interface BacktestSnapshot {
  hour: number;
  timestamp: number;
  openPrice: number;
  equityA: number;
  equityB: number;
  totalEquity: number;
  profitA: number;
  profitB: number;
  /** 总账户累计收益率 (%) */
  returnPct: number;
  /** 账户 A 累计收益率 (%) */
  returnAPct: number;
  /** 账户 B 累计收益率 (%) */
  returnBPct: number;
  action: string;     // open | add | reduce | nothing
}

export interface BacktestResult {
  summary: {
    startEquity: number;
    endEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    totalTrades: number;
    hoursElapsed: number;
    symbol: string;
    leverage: number;
    marginRatio: number;
  };
  snapshots: BacktestSnapshot[];
}

export interface BacktestParams {
  symbol: string;
  days: number;
  leverage: number;
  marginRatio: number;
  positionAmountType: 'profit' | 'fixed' | 'equityPct';
  positionAmountValue: number;
}

/** 从 Binance REST 获取历史 K 线 */
async function fetchCandles(symbol: string, days: number): Promise<Candle[]> {
  const limit = Math.min(days * 24, 1500);
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=1h&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json() as unknown[][];

  // 如果超过 1500 根，需要分页
  let allCandles: Candle[] = data.map(k => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));

  // 如果需要超过 1500 根，分多次请求
  const needed = days * 24;
  while (allCandles.length < needed && allCandles.length >= 1500) {
    const earliest = allCandles[0].openTime;
    const url2 = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=1h&limit=1500&endTime=${earliest - 1}`;
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

  // 只保留需要的数量（取最后 N 根）
  if (allCandles.length > needed) {
    allCandles = allCandles.slice(allCandles.length - needed);
  }

  return allCandles;
}

/** 运行回测 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const { symbol, days, leverage, marginRatio, positionAmountType, positionAmountValue } = params;
  const initialBalance = 1000;

  // 根据配置计算加减仓金额
  const calcAmount = (profit: number, equity: number): number => {
    if (positionAmountType === 'profit') return Math.abs(profit);
    if (positionAmountType === 'fixed') return positionAmountValue;
    return equity * positionAmountValue / 100; // equityPct
  };

  // 获取历史数据
  const candles = await fetchCandles(symbol, days);
  if (candles.length < 2) {
    throw new Error(`获取到 ${candles.length} 根 K 线，至少需要 2 根`);
  }

  // 创建账户
  const accA = new Account('A-long', 'long', initialBalance);
  const accB = new Account('B-short', 'short', initialBalance);

  const snapshots: BacktestSnapshot[] = [];
  let peakEquity = initialBalance * 2;
  let maxDrawdown = 0;
  let prevEquityA = initialBalance;
  let prevEquityB = initialBalance;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    if (i === 0) {
      // 首根 K 线：开仓
      accA.openPosition(candle.open, accA.balance * config.positionMarginRatio);
      accB.openPosition(candle.open, accB.balance * config.positionMarginRatio);
      prevEquityA = accA.getEquity(candle.open);
      prevEquityB = accB.getEquity(candle.open);
      snapshots.push({
        hour: 0,
        timestamp: candle.openTime,
        openPrice: candle.open,
        equityA: prevEquityA,
        equityB: prevEquityB,
        totalEquity: prevEquityA + prevEquityB,
        profitA: 0,
        profitB: 0,
        returnPct: 0,
        returnAPct: 0,
        returnBPct: 0,
        action: 'open',
      });
      continue;
    }

    // 小时边界：计算盈亏、加仓/减仓
    let action = 'nothing';
    const price = candle.open;
    const equityA = accA.getEquity(price);
    const equityB = accB.getEquity(price);
    const profitA = equityA - prevEquityA;
    const profitB = equityB - prevEquityB;

    // 盈利加仓 / 亏损减仓（分别处理 A、B）
    const actions: string[] = [];
    const amountA = calcAmount(profitA, equityA);
    const amountB = calcAmount(profitB, equityB);
    if (profitA > config.tradeThreshold && accA.position) {
      accA.addToPosition(price, amountA);
      actions.push('addA');
    } else if (profitA < -config.tradeThreshold && accA.position) {
      accA.reducePosition(price, amountA);
      actions.push('reduceA');
    }
    if (profitB > config.tradeThreshold && accB.position) {
      accB.addToPosition(price, amountB);
      actions.push('addB');
    } else if (profitB < -config.tradeThreshold && accB.position) {
      accB.reducePosition(price, amountB);
      actions.push('reduceB');
    }
    if (actions.length === 2) {
      // 两个账户都有操作：合并，如 addA_reduceB
      action = actions.join('_');
    } else if (actions.length === 1) {
      action = actions[0];
    }

    prevEquityA = accA.getEquity(price);
    prevEquityB = accB.getEquity(price);
    const totalEquity = prevEquityA + prevEquityB;

    // 追踪最大回撤
    if (totalEquity > peakEquity) peakEquity = totalEquity;
    const drawdown = peakEquity > 0 ? (peakEquity - totalEquity) / peakEquity * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    snapshots.push({
      hour: i,
      timestamp: candle.openTime,
      openPrice: price,
      equityA: prevEquityA,
      equityB: prevEquityB,
      totalEquity,
      profitA: Math.round(profitA * 100) / 100,
      profitB: Math.round(profitB * 100) / 100,
      returnPct: Math.round(((prevEquityA + prevEquityB - 2000) / 2000) * 10000) / 100,
      returnAPct: Math.round(((prevEquityA - 1000) / 1000) * 10000) / 100,
      returnBPct: Math.round(((prevEquityB - 1000) / 1000) * 10000) / 100,
      action,
    });
  }

  // 计算最终结果
  const startTotal = initialBalance * 2;
  const endTotal = prevEquityA + prevEquityB;
  const totalReturnPct = ((endTotal - startTotal) / startTotal) * 100;

  return {
    summary: {
      startEquity: startTotal,
      endEquity: Math.round(endTotal * 100) / 100,
      totalReturnPct: Math.round(totalReturnPct * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdown * 100) / 100,
      totalTrades: snapshots.filter(s => s.action !== 'nothing').length,
      hoursElapsed: candles.length,
      symbol,
      leverage,
      marginRatio,
    },
    snapshots,
  };
}
