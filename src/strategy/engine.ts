/**
 * 双账户对冲策略引擎
 * 核心循环：小时边界加仓/减仓
 */

import { EventEmitter } from 'events';
import { config } from '../config.js';
import { Account } from '../account/Account.js';
import type { IMarket, Candle, SimSnapshot, AccountSnapshot } from '../types.js';

export interface EngineEvents {
  snapshot: (snap: SimSnapshot) => void;
  stop: (reason: string) => void;
  error: (err: Error) => void;
}

export class StrategyEngine extends EventEmitter {
  private market: IMarket;
  private accA: Account; // 做多
  private accB: Account; // 做空
  private startTime = 0;
  private running = false;
  private started = false;
  private lastHourTimestamp = 0;
  private elapsedHours = 0;
  private logEntries: string[] = [];

  /** 上小时结束时记录的各账户权益，用于计算本小时盈亏 */
  private prevEquityA = config.initialBalance;
  private prevEquityB = config.initialBalance;

  constructor(market: IMarket) {
    super();
    this.market = market;
    this.accA = new Account('Account-A-long', 'long', config.initialBalance);
    this.accB = new Account('Account-B-short', 'short', config.initialBalance);
  }

  /** 启动引擎 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // 监听市场价格
    this.market.on('price', () => {
      if (this.started) return; // 价格更新由定时器读取
    });

    // 监听小时 K 线
    this.market.on('hourCandle', (candle: Candle) => this.onHourCandle(candle));

    // 如果已经有小时 K 线（重连场景），使用它
    if (this.market.lastHourCandle) {
      this.initFromCandle(this.market.lastHourCandle);
    }

    this.addLog('策略引擎已启动，等待小时 K 线...');
  }

  /** 收到小时 K 线 */
  private onHourCandle(candle: Candle): void {
    this.emitSnapshot('candle');

    // 如果是第一根 K 线：初始化开仓
    if (!this.started) {
      this.initFromCandle(candle);
      return;
    }

    // 忽略重复或更早的 K 线
    if (candle.openTime <= this.lastHourTimestamp) return;

    // 小时边界处理
    this.handleHourBoundary(candle);
  }

  /** 从 K 线初始化开仓 */
  private initFromCandle(candle: Candle): void {
    if (this.started) return;
    this.started = true;
    this.lastHourTimestamp = candle.openTime;

    const price = candle.open;

    this.accA.openPosition(price, this.accA.balance * config.positionMarginRatio);
    this.accB.openPosition(price, this.accB.balance * config.positionMarginRatio);

    this.prevEquityA = this.accA.getEquity(price);
    this.prevEquityB = this.accB.getEquity(price);

    this.addLog(`初始开仓 @ ${price.toFixed(2)}：A 多 / B 空`);
    this.emitSnapshot('init');
  }

  /** 小时边界：加仓/减仓 */
  private handleHourBoundary(candle: Candle): void {
    const price = candle.open;
    this.lastHourTimestamp = candle.openTime;
    this.elapsedHours++;

    // 1) 计算上小时盈亏（当前权益 - 上小时开始时的权益 - 本小时内的操作影响）
    const equityA = this.accA.getEquity(price);
    const equityB = this.accB.getEquity(price);
    const profitA = equityA - this.prevEquityA;
    const profitB = equityB - this.prevEquityB;

    this.addLog(`小时 #${this.elapsedHours}：A 盈亏=${profitA.toFixed(2)}, B 盈亏=${profitB.toFixed(2)}`);

    // 2) 加仓/减仓：按配置的模式计算金额
    const calcAmount = (profit: number, equity: number): number => {
      if (config.positionAmountType === 'profit') return Math.abs(profit);
      if (config.positionAmountType === 'fixed') return config.positionAmountValue;
      return equity * config.positionAmountValue / 100; // equityPct
    };
    const amountA = calcAmount(profitA, equityA);
    const amountB = calcAmount(profitB, equityB);
    if (profitA > config.tradeThreshold) {
      this.accA.addToPosition(price, amountA);
      this.addLog(`A 加仓 +${amountA.toFixed(2)} USD @ ${price.toFixed(2)}`);
    } else if (profitA < -config.tradeThreshold) {
      this.accA.reducePosition(price, amountA);
      this.addLog(`A 减仓 -${amountA.toFixed(2)} USD @ ${price.toFixed(2)}`);
    }
    if (profitB > config.tradeThreshold) {
      this.accB.addToPosition(price, amountB);
      this.addLog(`B 加仓 +${amountB.toFixed(2)} USD @ ${price.toFixed(2)}`);
    } else if (profitB < -config.tradeThreshold) {
      this.accB.reducePosition(price, amountB);
      this.addLog(`B 减仓 -${amountB.toFixed(2)} USD @ ${price.toFixed(2)}`);
    }

    // 更新上小时权益基准
    this.prevEquityA = this.accA.getEquity(price);
    this.prevEquityB = this.accB.getEquity(price);

    this.emitSnapshot('hour');
  }


  /** 推送快照 */
  private emitSnapshot(type: string): void {
    const price = this.market.currentPrice || 0;
    const snapA = this.accA.snapshot(price);
    const snapB = this.accB.snapshot(price);

    const snapshot: SimSnapshot = {
      timestamp: Date.now(),
      startTime: this.startTime,
      currentPrice: price,
      accounts: [snapA, snapB],
      totalEquity: snapA.equity + snapB.equity,
      hourlyProfit: 0, // 由引擎外部计算
      elapsedHours: this.elapsedHours,
      logEntries: this.logEntries.slice(-100),
    };

    this.emit('snapshot', snapshot);
  }

  /** 添加日志 */
  private addLog(msg: string): void {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const entry = `[${ts}] ${msg}`;
    this.logEntries.push(entry);
    console.log(entry);
  }

  /** 获取当前快照 */
  getSnapshot(): SimSnapshot | null {
    const price = this.market.currentPrice;
    if (price <= 0) return null;
    const snapA = this.accA.snapshot(price);
    const snapB = this.accB.snapshot(price);
    return {
      timestamp: Date.now(),
      startTime: this.startTime,
      currentPrice: price,
      accounts: [snapA, snapB],
      totalEquity: snapA.equity + snapB.equity,
      hourlyProfit: 0,
      elapsedHours: this.elapsedHours,
      logEntries: this.logEntries.slice(-100),
    };
  }

  /** 停止引擎 */
  stop(): void {
    this.running = false;
    this.market.destroy();
  }
}
