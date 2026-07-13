/**
 * Binance 合约行情模块
 *
 * 方案：
 *   - WebSocket 订阅 bookTicker → 实时价格
 *   - REST API /fapi/v1/klines → 小时 K 线边界（小时开盘价）
 *   - 本地定时器检测小时切换
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import type { Candle } from '../types.js';

/** REST API 基地址 */
const REST_BASE = 'https://fapi.binance.com';

export class BinanceMarket extends EventEmitter {
  private ws: WebSocket | null = null;
  private _currentPrice = 0;
  private _lastHourCandle: Candle | null = null;
  private destroyed = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private hourCheckTimer: ReturnType<typeof setInterval> | null = null;

  get currentPrice(): number {
    return this._currentPrice;
  }

  get lastHourCandle(): Candle | null {
    return this._lastHourCandle;
  }

  start(): void {
    if (this.destroyed) return;
    this.connectWs();
    this.startHourCheck();
  }

  // ---- WebSocket (bookTicker) ----

  private connectWs(): void {
    if (this.destroyed) return;
    this.cleanupWs();

    const url = `${config.binanceWsUrl}/ws`;
    console.log(`[WS] 连接中 (第${this.reconnectAttempts + 1}次)...`);

    const ws = new WebSocket(url);

    ws.on('error', (err: Error) => {
      console.error(`[WS] 错误: ${err.message}`);
    });

    ws.on('open', () => {
      console.log('[WS] 已连接');
      this.reconnectAttempts = 0;
      this.ws = ws;
      this.startPing();
      ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [`${config.symbol}@bookTicker`],
        id: 1,
      }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleWsMessage(msg);
      } catch { /* ignore */ }
    });

    ws.on('close', (code: number) => {
      console.log(`[WS] 断开 (code=${code})`);
      this.cleanupWs();
      this.scheduleReconnect();
    });
  }

  private handleWsMessage(msg: Record<string, unknown>): void {
    // 跳过订阅确认消息
    if ('result' in msg) return;

    if (msg['e'] === 'bookTicker') {
      const bid = Number(msg['b'] ?? 0);
      const ask = Number(msg['a'] ?? 0);
      if (bid > 0 && ask > 0) {
        this._currentPrice = (bid + ask) / 2;
        this.emit('price', this._currentPrice);
      }
    }
  }

  // ---- REST API 获取小时 K 线 ----

  private async fetchHourCandle(): Promise<Candle | null> {
    try {
      const url = `${REST_BASE}/fapi/v1/klines?symbol=${config.symbol.toUpperCase()}&interval=1h&limit=1`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as unknown[][];
      if (!data || data.length === 0) return null;
      const k = data[0];
      return {
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
      };
    } catch {
      return null;
    }
  }

  // ---- 小时边界检测（每秒检查一次） ----

  private startHourCheck(): void {
    this.stopHourCheck();
    // 启动时立即获取一次当前小时 K 线
    setTimeout(() => this.checkHourBoundary(), 1000);
    // 每秒检查
    this.hourCheckTimer = setInterval(() => this.checkHourBoundary(), 1000);
  }

  private stopHourCheck(): void {
    if (this.hourCheckTimer) {
      clearInterval(this.hourCheckTimer);
      this.hourCheckTimer = null;
    }
  }

  private async checkHourBoundary(): Promise<void> {
    const now = Date.now();
    const currentHourStart = Math.floor(now / 3600000) * 3600000;

    // 已经处理过这个小时的 K 线，跳过
    if (this._lastHourCandle?.openTime === currentHourStart) return;

    // 获取当前小时 K 线
    const candle = await this.fetchHourCandle();
    if (!candle) return;

    const prev = this._lastHourCandle;
    if (!prev || candle.openTime > prev.openTime) {
      const ts = new Date(candle.openTime).toLocaleTimeString('zh-CN', { hour12: false });
      console.log(`[K线] 新小时: ${ts}, 开仓价=${candle.open}`);
      this._lastHourCandle = candle;
      this.emit('hourCandle', candle);
    }
  }

  // ---- 心跳 / 重连 / 清理 ----

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 3 * 60 * 1000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60_000);
    console.log(`[WS] ${Math.round(delay / 1000)} 秒后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWs();
    }, delay);
  }

  private cleanupWs(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHourCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupWs();
  }
}
