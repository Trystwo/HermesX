/**
 * Web 服务 + WebSocket 推送
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { config } from '../config.js';
import { runBacktest } from '../backtest/runner.js';
import { initBacktest, stepBacktest, runAllBacktest } from '../backtest/runnerV2.js';
import { saveHistory, listHistory, getHistory, deleteHistory } from '../history/manager.js';
import { LiveEngineV2 } from '../live/engineV2.js';
import type { SimSnapshot, V2BacktestState, V2BacktestParams } from '../types.js';
import type { LiveState } from '../live/engineV2.js';
import { prodTrade } from '../exchange/binanceTrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

/** 获取本机局域网 IPv4 地址 */
function getLanIps(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

export function createServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: '50mb' }));

  // 静态文件（排除 index.html，由动态路由处理）
  app.use(express.static(publicDir, { index: false }));

  // 首页 — 服务端注入历史数据
  app.get('/', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    try {
      let html = fs.readFileSync(indexPath, 'utf-8');
      // 注入历史列表
      try {
        const items = listHistory();
        console.log('[SSR] 注入历史:', items.length, '条');
        if (items.length > 0) {
          const rows = items.map(i => {
            const d = new Date(i.timestamp);
            const time = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const color = i.totalReturnPct >= 0 ? '#22c55e' : '#ef4444';
            const sign = i.totalReturnPct >= 0 ? '+' : '';
            return `<div class="history-item" data-id="${i.id}" style="display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid #2a2d3a;cursor:pointer;font-size:11px">
              <span style="color:#888;width:130px;flex-shrink:0">${time}</span>
              <span style="color:#aaa;width:50px">${i.symbol.toUpperCase()}</span>
              <span style="color:#888;width:24px">${i.days}d</span>
              <span style="color:${color};width:65px;font-weight:600">${sign}${i.totalReturnPct}%</span>
              <span style="color:#f59e0b;width:44px">🛑${i.stopCount}</span>
              <span style="color:#888;width:40px">📋${i.orderCount}</span>
              <span style="flex:1"></span>
              <button style="font-size:10px;padding:1px 6px;background:#2a2d3a;border:none;border-radius:3px;color:#e8e8e8;cursor:pointer" onclick="showHistoryDetail('${i.id}')">查看</button>
              <button style="font-size:10px;padding:1px 4px;background:transparent;border:none;color:#ef4444;cursor:pointer" onclick="deleteHistoryItem('${i.id}')">✕</button>
            </div>`;
          }).join('\n');
          html = html.replace(
            '<p class="empty-hint" style="padding:20px 0;text-align:center" id="bt-history-empty">暂无记录</p>',
            rows
          );
        }
      } catch { /* ignore history injection errors */ }
      res.type('html').send(html);
    } catch (err) {
      res.status(500).send('Error loading page');
    }
  });

  // 输出目录
  const outputDir = path.join(__dirname, '..', '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  app.use('/output', express.static(outputDir));

  // 配置 API
  app.get('/config.json', (_req, res) => {
    res.json({
      stopLossPercent: config.stopLossPercent,
      initialBalance: config.initialBalance,
      leverage: config.leverage,
      marginRatio: config.marginRatio,
      feeRate: config.feeRate,
      symbol: config.symbol,
    });
  });

  // 回测 API
  app.post('/api/backtest', async (req, res) => {
    try {
      const { symbol, days, leverage, marginRatio, positionAmountType, positionAmountValue } = req.body;
      const result = await runBacktest({
        symbol: symbol || config.symbol,
        days: Math.min(Math.max(Number(days) || 30, 1), 365),
        leverage: Number(leverage) || config.leverage,
        marginRatio: Number(marginRatio) || config.marginRatio,
        positionAmountType: positionAmountType || config.positionAmountType,
        positionAmountValue: Number(positionAmountValue) || config.positionAmountValue,
      });

      // 保存 CSV 到项目文件夹
      const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
      const csvName = `backtest_${result.summary.symbol}_${ts}.csv`;
      const csvPath = path.join(outputDir, csvName);
      const actionLabels: Record<string, string> = {
        'open': '开仓', 'addA': 'A加仓', 'addB': 'B加仓', 'addAB': 'AB加仓',
        'reduceA': 'A减仓', 'reduceB': 'B减仓', 'reduceAB': 'AB减仓',
        'addA_reduceB': 'A加仓B减仓', 'reduceA_addB': 'A减仓B加仓',
        'stopA': 'A平仓', 'stopB': 'B平仓', 'stopAB': 'AB平仓',
        'reopenA': 'A重开', 'reopenB': 'B重开', 'reopenA_reopenB': 'AB重开',
        'nothing': '',
      };
      const csvHeader = '\uFEFF时间,时,开盘价,本时盈亏,总收益%,A收益%,B收益%,操作\n';
      const csvRows = result.snapshots.map(s => {
        const d = new Date(s.timestamp);
        const time = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} ${d.getHours()}:00`;
        const act = actionLabels[s.action] !== undefined ? actionLabels[s.action] : s.action;
        return `${time},${s.hour},${s.openPrice.toFixed(2)},${(s.profitA + s.profitB).toFixed(2)},${s.returnPct.toFixed(2)},${s.returnAPct.toFixed(2)},${s.returnBPct.toFixed(2)},${act}`;
      }).join('\n');
      try { fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf-8'); } catch { /* ignore */ }

      // 保存到历史
      const orderActions: Record<string, string> = { 'open':'开仓', 'addA':'A加仓', 'addB':'B加仓', 'addAB':'AB加仓', 'reduceA':'A减仓', 'reduceB':'B减仓', 'reduceAB':'AB减仓', 'addA_reduceB':'A加仓B减仓', 'reduceA_addB':'A减仓B加仓', 'stopA':'A平仓', 'stopB':'B平仓', 'stopAB':'AB平仓', 'reopenA':'A重开', 'reopenB':'B重开', 'reopenA_reopenB':'AB重开' };
      const orders = result.snapshots
        .filter(s => s.action !== 'nothing')
        .map(s => ({
          hour: s.hour,
          time: (() => { const d = new Date(s.timestamp); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`; })(),
          action: orderActions[s.action] || s.action,
          price: s.openPrice,
          profit: Math.round((s.profitA + s.profitB) * 100) / 100,
        }));
      saveHistory({
        symbol: req.body.symbol || config.symbol,
        days: Math.min(Math.max(Number(req.body.days) || 30, 1), 365),
        leverage: Number(req.body.leverage) || config.leverage,
        marginRatio: Number(req.body.marginRatio) || config.marginRatio,
        summary: {
          totalReturnPct: result.summary.totalReturnPct,
          maxDrawdownPct: result.summary.maxDrawdownPct,
          hoursElapsed: result.summary.hoursElapsed,
          stopCount: result.snapshots.filter(s => s.action.startsWith('stop')).length,
        },
        config: { stopLossPercent: config.stopLossPercent, feeRate: config.feeRate, tradeThreshold: config.tradeThreshold, positionMarginRatio: config.positionMarginRatio, leverage: Number(req.body.leverage) || config.leverage },
        orders,
      });

      res.json({ success: true, result, csvFile: csvName });
    } catch (err) {
      console.error('[Backtest] 错误:', err);
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // ========== v2 多空双开步骤回测 API ==========

  // 初始化
  app.post('/api/backtest/v2/init', async (req, res) => {
    try {
      const { symbol, days, interval, leverage, marginRatio, stopLossPercent, takeProfitPercent, positionAmountValue, initialBalance, direction } = req.body;
      const params: V2BacktestParams = {
        symbol: symbol || 'btcusdt',
        days: Math.min(Math.max(Number(days) || 7, 1), 365),
        interval: interval || '1h',
        leverage: Number(leverage) || 3,
        marginRatio: Number(marginRatio) || 0.8,
        stopLossPercent: Number(stopLossPercent) || 0.03,
        takeProfitPercent: Number(takeProfitPercent) || 0.05,
        positionAmountValue: Number(positionAmountValue) || 100,
        initialBalance: Number(initialBalance) || 1000,
        direction: direction || 'both',
      };
      const state = await initBacktest(params);
      res.json({ success: true, state });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // 前进一根 K 线
  app.post('/api/backtest/v2/step', (req, res) => {
    try {
      const state = req.body.state as V2BacktestState;
      if (!state) {
        return res.json({ success: false, error: '缺少 state 参数' });
      }
      const newState = stepBacktest(state);
      res.json({ success: true, state: newState });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // 一次跑完
  app.post('/api/backtest/v2/runAll', (req, res) => {
    try {
      const state = req.body.state as V2BacktestState;
      if (!state) {
        return res.json({ success: false, error: '缺少 state 参数' });
      }
      const newState = runAllBacktest(state);

      // v2 回测完成时保存历史
      const cpdMap: Record<string, number> = { '1m':1440,'3m':480,'5m':288,'15m':96,'30m':48,'1h':24,'2h':12,'4h':6,'6h':4,'8h':3,'12h':2,'1d':1 };
      const cpd = cpdMap[newState.params.interval] || 24;
      const days = Math.round(newState.candles.length / cpd);
      const lastSnap = newState.snapshots[newState.snapshots.length - 1];
      const totalReturnPct = lastSnap ? lastSnap.totalReturnPct : 0;
      // 从快照计算最大回撤
      let peak = newState.initialBalance;
      let maxDd = 0;
      for (const s of newState.snapshots) {
        if (s.equity > peak) peak = s.equity;
        const dd = peak > 0 ? (peak - s.equity) / peak * 100 : 0;
        if (dd > maxDd) maxDd = dd;
      }
      const v2Orders = newState.snapshots
        .filter(s => !s.action.includes('权益不足') && s.action !== '')
        .map((s, i) => ({
          hour: s.hour,
          time: (() => { const d = new Date(s.timestamp); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:00`; })(),
          action: s.action,
          price: s.openPrice,
          profit: i === 0 ? 0 : Math.round((s.equity - newState.snapshots[i-1].equity) * 100) / 100,
        }));
      const v2StopCount = newState.snapshots.filter(s => s.action.includes('止损')).length;
      // 保存末平仓持仓
      const lastPrice = lastSnap ? lastSnap.openPrice : (newState.candles[newState.candles.length - 1]?.open || 0);
      const openPositions = [
        ...newState.longLots.map(l => ({ side:'long', entryPrice:l.entryPrice, quantity:l.quantity, pnl:Math.round(((lastPrice - l.entryPrice) * l.quantity) * 100) / 100, currentPrice:lastPrice })),
        ...newState.shortLots.map(l => ({ side:'short', entryPrice:l.entryPrice, quantity:l.quantity, pnl:Math.round(((l.entryPrice - lastPrice) * l.quantity) * 100) / 100, currentPrice:lastPrice })),
      ];
      saveHistory({
        symbol: newState.symbol,
        days,
        leverage: newState.params.leverage,
        marginRatio: newState.params.marginRatio,
        summary: {
          totalReturnPct,
          maxDrawdownPct: Math.round(maxDd * 100) / 100,
          hoursElapsed: newState.candles.length,
          stopCount: v2StopCount,
        },
        config: {
          interval: newState.params.interval,
          stopLossPercent: newState.params.stopLossPercent,
          takeProfitPercent: newState.params.takeProfitPercent,
          positionAmountValue: newState.params.positionAmountValue,
          initialBalance: newState.initialBalance,
          leverage: newState.params.leverage,
          direction: newState.params.direction,
        },
        orders: v2Orders,
        positions: openPositions,
      });

      res.json({ success: true, state: newState });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // ========== 回测历史 CRUD ==========

  app.get('/api/history', (_req, res) => {
    try {
      const items = listHistory();
      res.json({ success: true, items });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  app.get('/api/history/:id', (req, res) => {
    try {
      const detail = getHistory(req.params.id);
      if (!detail) return res.json({ success: false, error: '未找到该回测记录' });
      res.json({ success: true, detail });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/api/history/:id', (req, res) => {
    try {
      const ok = deleteHistory(req.params.id);
      res.json({ success: ok, error: ok ? undefined : '删除失败或记录不存在' });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  // 模式切换
  app.post('/api/mode', (req, res) => {
    const { mode } = req.body;
    if (mode === 'live' || mode === 'backtest') {
      (globalThis as Record<string, unknown>).__mode = mode;
      console.log(`[Mode] 切换至 ${mode}`);
      res.json({ success: true, mode });
    } else {
      res.status(400).json({ success: false, error: 'invalid mode' });
    }
  });

  app.get('/api/mode', (_req, res) => {
    res.json({ mode: (globalThis as Record<string, unknown>).__mode || 'live' });
  });

  // ========== Live Engine V2 ==========

  // 从全局获取 liveEngine（由 index.ts 创建并绑定行情）
  let liveEngine: LiveEngineV2 | null = (globalThis as Record<string, unknown>).__liveEngineV2 as LiveEngineV2;
  if (!liveEngine) {
    // fallback（index.ts 未启动时）
    console.warn('[Live] 未检测到 liveEngine 实例，创建新实例（无行情绑定）');
    liveEngine = new LiveEngineV2();
    (globalThis as Record<string, unknown>).__liveEngineV2 = liveEngine;
  }

  // 实时状态推送（广播到 WebSocket）
  liveEngine.setBroadcast((state: LiveState) => {
    const msg = JSON.stringify({ type: 'liveState', state });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  app.post("/api/live/start", async (req, res) => {
    try {
      const cfg = req.body.config || {};
      const s = liveEngine.getState();
      if (cfg.initialBalance) s.config.initialBalance = Number(cfg.initialBalance);
      if (cfg.leverage) s.config.leverage = Number(cfg.leverage);
      if (cfg.stopLossPercent) s.config.stopLossPercent = Number(cfg.stopLossPercent);
      if (cfg.takeProfitPercent) s.config.takeProfitPercent = Number(cfg.takeProfitPercent);
      if (cfg.positionAmountValue) s.config.positionAmountValue = Number(cfg.positionAmountValue);
      if (cfg.mode) s.config.mode = cfg.mode;
      if (cfg.interval) s.config.interval = cfg.interval;
      if (cfg.direction) s.config.direction = cfg.direction;

      // 真实模式：先验证 API Key
      if (s.config.mode === 'real' && !prodTrade.hasApiKey()) {
        return res.json({ success: false, error: 'Binance API Key/Secret 未配置，请设置 .env 文件' });
      }
      if (s.config.mode === 'real') {
        const ok = await prodTrade.testConnection();
        if (!ok) {
          return res.json({ success: false, error: 'Binance API Key 验证失败' });
        }
      }
      const price = (globalThis as any).__lastPrice || 0;
      const now = Date.now();
      await liveEngine.start(Number(price), now - (now % 3600000));
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });

  app.post("/api/live/stop", (_req, res) => {
    liveEngine.stop();
    res.json({ success: true });
  });

  app.get("/api/live/state", (_req, res) => {
    try {
      const state = liveEngine.getState();
      res.json({ success: true, state });
    } catch (err) {
      res.json({ success: false, error: (err as Error).message });
    }
  });


  // WebSocket 服务
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WsClient>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[WS] 客户端已连接');

    // 新连接时立即推送当前 liveEngine 状态（解决刷新后页面重置问题）
    try {
      const state = liveEngine.getState();
      if (state.running) {
        const msg = JSON.stringify({ type: 'liveState', state });
        if (ws.readyState === WsClient.OPEN) {
          ws.send(msg);
        }
      }
    } catch { /* ignore push error on connect */ }

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[WS] 客户端已断开');
    });
  });

  // 广播函数
  const push = (snap: SimSnapshot) => {
    const msg = JSON.stringify(snap);
    for (const client of clients) {
      if (client.readyState === WsClient.OPEN) {
        client.send(msg);
      }
    }
  };

  (globalThis as Record<string, unknown>).__mode = 'live';
  (globalThis as Record<string, unknown>).__wsBroadcast = push;

  server.listen(config.port, config.host, () => {
    console.log(`[Server] 本地访问  http://localhost:${config.port}`);
    for (const ip of getLanIps()) {
      console.log(`[Server] 局域网访问 http://${ip}:${config.port}`);
    }
  });

  return { server, push, app };
}
