/**
 * 离线模拟行情模块
 * 生成随机价格数据，用于开发和测试（无需网络连接）
 */

import { EventEmitter } from 'events';
import type { Candle } from '../types.js';

export class MockMarket extends EventEmitter {
  private price = 50000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hourTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private lastHourTime = 0;
  private _currentPrice = 50000;
  private _lastHourCandle: Candle | null = null;

  get currentPrice(): number {
    return this._currentPrice;
  }

  get lastHourCandle(): Candle | null {
    return this._lastHourCandle;
  }

  start(): void {
    console.log('[Mock] 启动模拟行情，初始价格 $50000');

    // 每次推送价格变化（~3次/秒）
    this.timer = setInterval(() => {
      // 随机波动：约 ±0.15%
      const change = this.price * (Math.random() - 0.5) * 0.003;
      this.price += change;
      this._currentPrice = this.price;
      this.emit('price', this.price);
    }, 300);

    // 每小时模拟一根新 K 线（实际 5 秒一根，演示用）
    this.hourTimer = setInterval(() => {
      const now = Date.now();
      const open = this.price;
      const high = open * (1 + Math.random() * 0.005);
      const low = open * (1 - Math.random() * 0.005);
      const close = low + Math.random() * (high - low);

      const candle: Candle = {
        openTime: now,
        open,
        high,
        low,
        close,
      };

      this._lastHourCandle = candle;
      this.emit('hourCandle', candle);
      console.log(`[Mock] 新小时 K 线: 开盘 ${open.toFixed(2)}, 高 ${high.toFixed(2)}, 低 ${low.toFixed(2)}`);
    }, 5000); // 演示：每 5 秒触发一次"小时"边界
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.hourTimer) {
      clearInterval(this.hourTimer);
      this.hourTimer = null;
    }
  }
}
