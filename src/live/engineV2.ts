/**
 * LiveEngineV2 — 实时 v2 多空双开引擎
 *
 * 支持模拟/真实两种模式：
 *   模拟模式：用 AccountV2 本地算 PnL
 *   真实模式：通过 Binance API 下单 + reduce-only 止盈止损单
 *   1. 每检测到新小时 K 线 → 开新 lot + 挂止盈止损
 *   2. 止盈止损由 Binance 自动处理（reduce-only 止损单）
 *   3. 广播状态至前端
 */

import { AccountV2 } from '../account/AccountV2.js';
import { prodTrade, testnetTrade, BinanceTrade } from '../exchange/binanceTrade.js';
import type { Lot, V2BacktestSnapshot, V2BacktestState } from '../types.js';

const FEE_RATE = 0.0002;
const MAX_SNAPSHOTS = 2000;

export interface LiveConfig {
  symbol: string;
  initialBalance: number;
  leverage: number;
  marginRatio: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  positionAmountValue: number;
  interval: string;
  mode: 'sim' | 'real';
  direction: 'both' | 'long' | 'short';
}

const defaultConfig: LiveConfig = {
  symbol: 'btcusdt',
  initialBalance: 1000,
  leverage: 3,
  marginRatio: 0.8,
  stopLossPercent: 0.03,
  takeProfitPercent: 0.05,
  positionAmountValue: 100,
  interval: '1h',
  mode: 'sim',
  direction: 'both',
};

export interface LiveState {
  config: LiveConfig;
  running: boolean;
  startTime: number;
  balance: number;
  longLots: Lot[];
  shortLots: Lot[];
  snapshots: V2BacktestSnapshot[];
  totalFee: number;
  totalOpenCount: number;
  currentHour: number;
  lastPrice: number;
  logEntries: string[];
  /** 真实模式：标记 lot 的止盈止损订单 ID [lotIndex, orderId, type][] */
  orderIds: [number, number, 'sl' | 'tp'][];
}

function makeSnapshot(
  hour: number,
  price: number,
  timestamp: number,
  account: AccountV2,
  stoppedLots: V2BacktestSnapshot['stoppedLots'],
  action: string,
  initialBalance: number,
): V2BacktestSnapshot {
  const equity = account.getEquity(price);
  const unrealizedPnL = account.getUnrealizedPnL(price);
  return {
    hour,
    timestamp,
    openPrice: price,
    equity: Math.round(equity * 100) / 100,
    balance: Math.round(account.balance * 100) / 100,
    unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
    longPnL: Math.round(account.getLongPnL(price) * 100) / 100,
    shortPnL: Math.round(account.getShortPnL(price) * 100) / 100,
    totalReturnPct: Math.round(((equity - initialBalance) / initialBalance) * 10000) / 100,
    longLots: account.longLots.map(l => ({ ...l })),
    shortLots: account.shortLots.map(l => ({ ...l })),
    stoppedLots,
    action,
  };
}

export class LiveEngineV2 {
  private _state: LiveState;
  private _checkTimer: ReturnType<typeof setInterval> | null = null;
  private _lastCheckedHour = 0;
  private _broadcast: ((state: LiveState) => void) | null = null;

  constructor(config: Partial<LiveConfig> = {}) {
    const cfg = { ...defaultConfig, ...config };
    this._state = {
      config: cfg,
      running: false,
      startTime: 0,
      balance: cfg.initialBalance,
      longLots: [],
      shortLots: [],
      snapshots: [],
      totalFee: 0,
      totalOpenCount: 0,
      currentHour: 0,
      lastPrice: 0,
      logEntries: ['[Live V2] 引擎已创建，等待启动...'],
      orderIds: [],
    };
  }

  updateConfig(cfg: Partial<LiveConfig>) {
    Object.assign(this._state.config, cfg);
  }

  setBroadcast(fn: (state: LiveState) => void) {
    this._broadcast = fn;
  }

  getState(): LiveState {
    return this._state;
  }

  getV2State(): V2BacktestState {
    return {
      symbol: this._state.config.symbol,
      initialBalance: this._state.config.initialBalance,
      params: {
        interval: this._state.config.interval,
        leverage: this._state.config.leverage,
        marginRatio: this._state.config.marginRatio,
        stopLossPercent: this._state.config.stopLossPercent,
        takeProfitPercent: this._state.config.takeProfitPercent,
        positionAmountValue: this._state.config.positionAmountValue,
        direction: this._state.config.direction || 'both',
      },
      candles: [],
      currentIndex: this._state.snapshots.length,
      balance: this._state.balance,
      longLots: this._state.longLots,
      shortLots: this._state.shortLots,
      snapshots: this._state.snapshots,
      totalFee: this._state.totalFee,
      totalOpenCount: this._state.totalOpenCount,
      allLots: [],
      done: false,
    };
  }

  async start(currentPrice: number, currentHour: number) {
    if (this._state.running) return;
    this._state.running = true;
    this._state.startTime = Date.now();
    this._state.lastPrice = currentPrice;
    this._state.currentHour = currentHour;
    this._lastCheckedHour = currentHour;
    this._log('[Live V2] 🚀 引擎已启动');
    this._log(`[Live V2] 初始价格: $${currentPrice.toFixed(2)}`);
    const useTestnet = this._state.config.mode === 'sim' && testnetTrade.hasApiKey();
    let modeLabel = '🟢 本地模拟';
    if (this._state.config.mode === 'real') modeLabel = '🔴 真实交易';
    else if (useTestnet) modeLabel = '🟡 币安测试网';
    this._log(`[Live V2] 模式: ${modeLabel}`);

    // 实盘/测试网：设置双向持仓模式 + 同步持仓和余额
    if (this._state.config.mode === 'real' || useTestnet) {
      const trade = this._state.config.mode === 'real' ? prodTrade : testnetTrade;
      try {
        await trade.setHedgeMode();
        this._log(`[Live V2] ✅ 双向持仓模式已启用`);
      } catch (err) {
        this._log(`[Live V2] ⚠️ 设置双向持仓模式失败: ${(err as Error).message}`);
      }
      if (this._state.config.mode === 'real') {
        this._syncRealPosition(currentPrice);
      }
      // 设置杠杆
      try {
        await trade.setLeverage(this._state.config.symbol, this._state.config.leverage);
        this._log(`[Live V2] ✅ 杠杆已设为 ${this._state.config.leverage}x`);
      } catch (err) {
        this._log(`[Live V2] ⚠️ 设置杠杆失败: ${(err as Error).message}`);
      }
      // 测试网模式：从币安读取实际余额作为初始资金
      if (useTestnet) {
        try {
          const acct = await testnetTrade.getBalance();
          const bal = parseFloat(acct.availableBalance.toFixed(2));
          this._state.balance = bal;
          this._state.config.initialBalance = bal;
          this._log(`[Live V2] 测试网余额: $${bal.toFixed(2)}`);
        } catch (err) {
          this._log(`[Live V2] ⚠️ 获取测试网余额失败: ${(err as Error).message}，使用配置值 $${this._state.config.initialBalance}`);
        }
      }

      // 清除本地持仓状态（从交易所重新同步）
      if (useTestnet || this._state.config.mode === 'real') {
        try {
          await this._syncPositionFromBinance(trade);
        } catch {}
      }
    }

    // 首次开仓
    this._processNewHour(currentPrice, currentHour);

    // 1 秒定时：风控检查 + 状态广播
    this._checkTimer = setInterval(() => {
      if (!this._state.running) return;
      this._checkStopLoss();
      // 无变化也广播，前端每秒更新价格/权益
      this._broadcastState();
    }, 1000);
  }

  stop() {
    if (!this._state.running) return;
    this._state.running = false;
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
    this._log('[Live V2] ⏹️ 引擎已停止');
    this._broadcastState();
  }

  /** 从实盘 Binance 恢复持仓状态 */
  private async _syncRealPosition(currentPrice: number) {
    try {
      const pos = await prodTrade.getPosition();
      const balance = await prodTrade.getBalance();
      this._state.balance = parseFloat(balance.availableBalance.toFixed(2));
      if (pos && Math.abs(pos.positionAmt) > 1e-8) {
        const side = pos.positionAmt > 0 ? 'long' : 'short';
        const qty = Math.abs(pos.positionAmt);
        const entryPx = pos.entryPrice;
        const margin = (qty * entryPx) / pos.leverage;
        const lot: Lot = {
          side,
          entryPrice: entryPx,
          quantity: qty,
          margin,
          slPrice: side === 'long' ? entryPx * (1 - this._state.config.stopLossPercent) : entryPx * (1 + this._state.config.stopLossPercent),
          tpPrice: side === 'long' ? entryPx * (1 + this._state.config.takeProfitPercent) : entryPx * (1 - this._state.config.takeProfitPercent),
        };
        if (side === 'long') this._state.longLots.push(lot);
        else this._state.shortLots.push(lot);
        this._log(`[Live] 恢复持仓: ${side} ${qty.toFixed(6)} @$${entryPx.toFixed(2)}`);
      }
    } catch (err) {
      this._log(`[Live] ⚠️ 同步持仓失败: ${(err as Error).message}`);
    }
  }

  /** 由外部行情驱动调用 */
  updatePrice(price: number, nowMs: number) {
    if (!this._state.running) return;
    this._state.lastPrice = price;

    const hourTs = this._getHourTimestamp(nowMs);
    if (hourTs !== this._lastCheckedHour && hourTs !== this._state.currentHour) {
      this._lastCheckedHour = hourTs;
      this._processNewHour(price, hourTs);
    }
  }

  private async _processNewHour(price: number, hourTs: number) {
    const cfg = this._state.config;
    const useTestnet = cfg.mode === 'sim' && testnetTrade.hasApiKey();
    if (cfg.mode === 'real' || useTestnet) {
      const trade = cfg.mode === 'real' ? prodTrade : testnetTrade;
      await this._processNewHourWithTrade(price, hourTs, trade);
      return;
    }
    const account = new AccountV2(this._state.balance);
    account.longLots = this._state.longLots.map(l => ({ ...l }));
    account.shortLots = this._state.shortLots.map(l => ({ ...l }));

    const stoppedLots = account.checkCloseConditions(price, price, FEE_RATE);
    const closeFee = stoppedLots.reduce((sum, l) => sum + l.fee, 0);

    const actionParts: string[] = [];
    if (stoppedLots.length > 0) {
      const sl = stoppedLots.filter(l => l.reason === 'sl').length;
      const tp = stoppedLots.filter(l => l.reason === 'tp').length;
      if (sl > 0) actionParts.push(`⛔止损${sl}单`);
      if (tp > 0) actionParts.push(`🎯止盈${tp}单`);
    }

    const equity = account.getEquity(price);
    const available = account.balance + account.getUnrealizedPnL(price);
    const marginPerSide = this._state.config.positionAmountValue;
    const dir = this._state.config.direction || 'both';
    const sides = dir === 'both' ? 2 : 1;
    let openFee = 0;
    let didOpen = false;

    if (equity > 0 && available >= marginPerSide * sides) {
      const posValue = marginPerSide * this._state.config.leverage;
      if (dir === 'both' || dir === 'long') {
        actionParts.push('🟢开多');
        account.openLong(price, marginPerSide, this._state.config.leverage, FEE_RATE,
          this._state.config.stopLossPercent, this._state.config.takeProfitPercent);
        openFee += posValue * FEE_RATE;
      }
      if (dir === 'both' || dir === 'short') {
        actionParts.push('🔴开空');
        account.openShort(price, marginPerSide, this._state.config.leverage, FEE_RATE,
          this._state.config.stopLossPercent, this._state.config.takeProfitPercent);
        openFee += posValue * FEE_RATE;
      }
      didOpen = true;
    } else {
      actionParts.push('⚠️权益不足');
    }

    const action = actionParts.join(' ');
    const snap = makeSnapshot(
      this._state.snapshots.length,
      price, hourTs, account, stoppedLots, action,
      this._state.config.initialBalance,
    );

    this._state.balance = account.balance;
    this._state.longLots = account.longLots;
    this._state.shortLots = account.shortLots;
    this._state.snapshots = [...this._state.snapshots, snap].slice(-MAX_SNAPSHOTS);
    this._state.totalFee += openFee + closeFee;
    this._state.totalOpenCount += (didOpen ? 1 : 0);
    this._state.currentHour = hourTs;

    this._log(`[${new Date(hourTs).toISOString().slice(11,16)}] ${action} @$${price.toFixed(2)}`);
    this._broadcastState();
  }

  /** 通过 Binance API 开仓（实盘或测试网） */
  private async _processNewHourWithTrade(price: number, hourTs: number, trade: BinanceTrade) {
    const cfg = this._state.config;
    const marginPerSide = cfg.positionAmountValue;
    const actionParts: string[] = [];
    let didOpen = false;

    try {
      // 取消旧的止盈止损单
      if (this._state.orderIds.length > 0) {
        await trade.cancelAllOrders();
        this._state.orderIds = [];
      }

      // 查询当前余额
      const balance = await trade.getBalance();
      this._state.balance = parseFloat(balance.availableBalance.toFixed(2));

      // 开新仓（根据方向）
      const qty = trade.calcQuantity(marginPerSide, cfg.leverage, price);
      const dir = cfg.direction || 'both';
      if (qty <= 0) {
        actionParts.push('⚠️计算数量为0');
      } else if (balance.availableBalance < marginPerSide * (dir === 'both' ? 2 : 1)) {
        actionParts.push('⚠️余额不足');
      } else {
        let didLong = false, didShort = false;
        let avgLong = price, avgShort = price;

        if (dir === 'both' || dir === 'long') {
          const r = await trade.marketOpen('BUY', qty, 'LONG');
          avgLong = r.avgPrice || price;
          const lot: Lot = {
            side: 'long', entryPrice: avgLong, quantity: r.executedQty,
            margin: marginPerSide,
            slPrice: avgLong * (1 - cfg.stopLossPercent),
            tpPrice: avgLong * (1 + cfg.takeProfitPercent),
          };
          this._state.longLots.push(lot);
          didLong = true;
          if (cfg.mode === 'real') {
            const slO = await trade.placeReduceOrder('SELL', r.executedQty, lot.slPrice, 'STOP_MARKET');
            const tpO = await trade.placeReduceOrder('SELL', r.executedQty, lot.tpPrice, 'TAKE_PROFIT_MARKET');
            this._state.orderIds.push(
              [this._state.longLots.length - 1, slO.orderId, 'sl'],
              [this._state.longLots.length - 1, tpO.orderId, 'tp'],
            );
          }
          actionParts.push('🟢开多');
        }

        if (dir === 'both' || dir === 'short') {
          const r = await trade.marketOpen('SELL', qty, 'SHORT');
          avgShort = r.avgPrice || price;
          const lot: Lot = {
            side: 'short', entryPrice: avgShort, quantity: r.executedQty,
            margin: marginPerSide,
            slPrice: avgShort * (1 + cfg.stopLossPercent),
            tpPrice: avgShort * (1 - cfg.takeProfitPercent),
          };
          this._state.shortLots.push(lot);
          didShort = true;
          if (cfg.mode === 'real') {
            const slO = await trade.placeReduceOrder('BUY', r.executedQty, lot.slPrice, 'STOP_MARKET');
            const tpO = await trade.placeReduceOrder('BUY', r.executedQty, lot.tpPrice, 'TAKE_PROFIT_MARKET');
            this._state.orderIds.push(
              [this._state.shortLots.length - 1, slO.orderId, 'sl'],
              [this._state.shortLots.length - 1, tpO.orderId, 'tp'],
            );
          }
          actionParts.push('🔴开空');
        }

        this._state.totalOpenCount++;
        didOpen = true;
        this._log(`[Live 开仓] ${actionParts.join(' ')} @$${price.toFixed(2)}`);
      }
    } catch (err) {
      this._log(`[Live] ❌ 开仓失败: ${(err as Error).message}`);
      actionParts.push('❌失败');
    }

    const action = actionParts.join(' ');
    const totalEquity = this._state.balance
      + this._state.longLots.reduce((a, l) => a + (price - l.entryPrice) * l.quantity, 0)
      + this._state.shortLots.reduce((a, l) => a + (l.entryPrice - price) * l.quantity, 0);
    const snap: V2BacktestSnapshot = {
      hour: this._state.snapshots.length,
      timestamp: hourTs,
      openPrice: price,
      equity: Math.round(totalEquity * 100) / 100,
      balance: Math.round(this._state.balance * 100) / 100,
      unrealizedPnL: Math.round((totalEquity - this._state.balance) * 100) / 100,
      longPnL: Math.round(this._state.longLots.reduce((a, l) => a + (price - l.entryPrice) * l.quantity, 0) * 100) / 100,
      shortPnL: Math.round(this._state.shortLots.reduce((a, l) => a + (l.entryPrice - price) * l.quantity, 0) * 100) / 100,
      totalReturnPct: Math.round(((totalEquity - cfg.initialBalance) / cfg.initialBalance) * 10000) / 100,
      longLots: this._state.longLots.map(l => ({ ...l })),
      shortLots: this._state.shortLots.map(l => ({ ...l })),
      stoppedLots: [],
      action,
    };

    this._state.snapshots = [...this._state.snapshots, snap].slice(-MAX_SNAPSHOTS);
    if (didOpen) this._state.currentHour = hourTs;

    this._log(`[${new Date(hourTs).toISOString().slice(11,16)}] ${action} @$${price.toFixed(2)}`);
    this._broadcastState();
  }

  /** 3 秒定时任务 */
  private async _checkStopLoss() {
    if (this._state.longLots.length === 0 && this._state.shortLots.length === 0) return;

    const cfg = this._state.config;
    const useTestnet = cfg.mode === 'sim' && testnetTrade.hasApiKey();

    // 实盘：止盈止损由 Binance 处理，只需同步持仓
    if (cfg.mode === 'real') {
      await this._syncPositionFromBinance(prodTrade);
      return;
    }

    // 测试网：本地检查 SL/TP，触发后用市价单平仓
    if (useTestnet) {
      const price = this._state.lastPrice;
      const closedLots: { side: string; lot: Lot; reason: 'sl' | 'tp' }[] = [];
      for (const lot of this._state.longLots) {
        if (price <= lot.slPrice) closedLots.push({ side: 'long', lot, reason: 'sl' });
        else if (price >= lot.tpPrice) closedLots.push({ side: 'long', lot, reason: 'tp' });
      }
      for (const lot of this._state.shortLots) {
        if (price >= lot.slPrice) closedLots.push({ side: 'short', lot, reason: 'sl' });
        else if (price <= lot.tpPrice) closedLots.push({ side: 'short', lot, reason: 'tp' });
      }

      if (closedLots.length > 0) {
        for (const cl of closedLots) {
          try {
            const side = cl.side === 'long' ? 'SELL' : 'BUY';
            const posSide = cl.side === 'long' ? 'LONG' : 'SHORT';
            await testnetTrade.marketClose(side, cl.lot.quantity, posSide);
            this._log(`[⏱️] ${cl.reason === 'sl' ? '⛔止损' : '🎯止盈'} ${cl.side} @$${price.toFixed(2)}`);
          } catch (err) {
            this._log(`[⏱️] ⚠️ 平仓失败: ${(err as Error).message}`);
          }
        }
        // 重新查询余额
        try {
          const bal = await testnetTrade.getBalance();
          this._state.balance = parseFloat(bal.availableBalance.toFixed(2));
        } catch {}
        this._state.longLots = this._state.longLots.filter(l => !closedLots.some(cl => cl.lot === l));
        this._state.shortLots = this._state.shortLots.filter(l => !closedLots.some(cl => cl.lot === l));
        this._broadcastState();
      }
      return;
    }

    const account = new AccountV2(this._state.balance);
    account.longLots = this._state.longLots.map(l => ({ ...l }));
    account.shortLots = this._state.shortLots.map(l => ({ ...l }));
    const price = this._state.lastPrice;

    const stoppedLots = account.checkCloseConditions(price, price, FEE_RATE);
    if (stoppedLots.length === 0) return;

    const closeFee = stoppedLots.reduce((sum, l) => sum + l.fee, 0);
    const sl = stoppedLots.filter(l => l.reason === 'sl').length;
    const tp = stoppedLots.filter(l => l.reason === 'tp').length;
    const parts: string[] = [];
    if (sl > 0) parts.push(`⛔止损${sl}单`);
    if (tp > 0) parts.push(`🎯止盈${tp}单`);

    const snap = makeSnapshot(
      this._state.snapshots.length,
      price, Date.now(), account, stoppedLots, parts.join(' '),
      this._state.config.initialBalance,
    );

    this._state.balance = account.balance;
    this._state.longLots = account.longLots;
    this._state.shortLots = account.shortLots;
    this._state.snapshots = [...this._state.snapshots, snap].slice(-MAX_SNAPSHOTS);
    this._state.totalFee += closeFee;

    this._log(`[⏱️] ${parts.join(' ')} @$${price.toFixed(2)}`);
    this._broadcastState();
  }

  /** 从 Binance 同步持仓状态 */
  private async _syncPositionFromBinance(trade: BinanceTrade) {
    try {
      const pos = await trade.getPosition();
      if (!pos || Math.abs(pos.positionAmt) < 1e-8) {
        if (this._state.longLots.length > 0 || this._state.shortLots.length > 0) {
          this._log('[Live] 仓位已空（止盈/止损已触发）');
          this._state.longLots = [];
          this._state.shortLots = [];
          this._state.orderIds = [];
          this._broadcastState();
        }
        return;
      }
      // 更新余额
      const balance = await trade.getBalance();
      this._state.balance = parseFloat(balance.availableBalance.toFixed(2));
      this._state.lastPrice = pos.markPrice;
    } catch {
      // 忽略查询错误
    }
  }

  private _getHourTimestamp(ms: number): number {
    const interval = this._state.config.interval || '1h';
    const minutes = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440 }[interval] || 60;
    const d = new Date(ms);
    const totalMin = d.getHours() * 60 + d.getMinutes();
    const roundedMin = Math.floor(totalMin / minutes) * minutes;
    d.setHours(0, roundedMin, 0, 0);
    return d.getTime();
  }

  private _log(msg: string) {
    this._state.logEntries.push(msg);
    if (this._state.logEntries.length > 500) {
      this._state.logEntries = this._state.logEntries.slice(-500);
    }
    console.log(msg);
  }

  private _broadcastState() {
    if (!this._broadcast) return;

    // 创建实时快照用于前端图表更新
    const price = this._state.lastPrice;
    const longPnL = this._state.longLots.reduce((a, l) => a + (price - l.entryPrice) * l.quantity, 0);
    const shortPnL = this._state.shortLots.reduce((a, l) => a + (l.entryPrice - price) * l.quantity, 0);
    const totalEquity = this._state.balance + longPnL + shortPnL;
    const realtimeSnap: V2BacktestSnapshot = {
      hour: this._state.snapshots.length,
      timestamp: Date.now(),
      openPrice: price,
      equity: Math.round(totalEquity * 100) / 100,
      balance: Math.round(this._state.balance * 100) / 100,
      unrealizedPnL: Math.round((longPnL + shortPnL) * 100) / 100,
      longPnL: Math.round(longPnL * 100) / 100,
      shortPnL: Math.round(shortPnL * 100) / 100,
      totalReturnPct: Math.round(((totalEquity - this._state.config.initialBalance) / this._state.config.initialBalance) * 10000) / 100,
      longLots: this._state.longLots.map(l => ({ ...l })),
      shortLots: this._state.shortLots.map(l => ({ ...l })),
      stoppedLots: [],
      action: '',
    };

    // 广播时附加实时快照（不修改 _state.snapshots）
    this._broadcast({
      ...this._state,
      snapshots: [...this._state.snapshots, realtimeSnap],
    });
  }
}
