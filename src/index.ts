/**
 * HermesX 入口文件
 * 
 * 启动方式：
 *   npm run dev     — 连接 Binance 实时行情
 *   npm run mock    — 离线模拟模式（随机价格，用于开发和测试）
 */

import { config } from './config.js';
import { BinanceMarket } from './exchange/binance.js';
import { StrategyEngine } from './strategy/engine.js';
import { createServer } from './server/app.js';
import { MockMarket } from './exchange/mock.js';
import { LiveEngineV2 } from './live/engineV2.js';
import type { IMarket, SimSnapshot } from './types.js';

async function main() {
  console.log('═'.repeat(50));
  console.log('  HermesX — 双账户对冲实时模拟交易系统');
  console.log(`  止损阈值: ${(config.stopLossPercent * 100)}%`);
  console.log(`  杠杆: ${config.leverage}x`);
  console.log(`  保证金比例: ${(config.marginRatio * 100)}%`);
  console.log(`  初始资金: $${config.initialBalance} × 2 账户`);
  console.log('═'.repeat(50));

  // 1. 启动行情模块
  let market: IMarket;
  let isMock = config.mockMode;

  if (isMock) {
    console.log('[启动] 离线模拟模式（随机价格）');
    market = new MockMarket();
    market.start();
  } else {
    console.log('[启动] 连接 Binance 合约行情...');
    market = new BinanceMarket();
    market.start();
  }

  // 2. 启动 v2 实时引擎（先创建，由 UI 控制启停）
  const liveEngineV2 = new LiveEngineV2({
    initialBalance: config.initialBalance,
    leverage: config.leverage,
    stopLossPercent: config.stopLossPercent,
    symbol: config.symbol,
    positionAmountValue: config.positionAmountValue,
  });
  (globalThis as Record<string, unknown>).__liveEngineV2 = liveEngineV2;

  // 行情更新时通知 liveEngineV2
  market.on('price', (price: number) => {
    (globalThis as Record<string, unknown>).__lastPrice = price;
    liveEngineV2.updatePrice(price, Date.now());
  });

  // 3. 启动策略引擎（v1）
  const engine = new StrategyEngine(market);
  engine.start();

  // 4. 启动 Web 服务
  let broadcast: (snap: SimSnapshot) => void;

  try {
    const server = createServer();
    broadcast = server.push;
  } catch (err) {
    console.error('[启动] Web 服务启动失败:', err);
    broadcast = () => {};
  }

  // 5. 引擎状态变化时推送给 Web 客户端
  engine.on('snapshot', (snap: SimSnapshot) => {
    broadcast(snap);
  });

  engine.on('stop', (reason: string) => {
    console.log(`[引擎] 停止: ${reason}`);
  });

  engine.on('error', (err: Error) => {
    console.error('[引擎] 错误:', err.message);
  });

  // 如果使用离线模式，每秒打印状态到控制台
  if (isMock) {
    setInterval(() => {
      const snap = engine.getSnapshot();
      if (snap) {
        const { accounts, totalEquity, currentPrice } = snap;
        const a = accounts[0], b = accounts[1];
        const totalPnl = totalEquity - 2000;
        process.stdout.write(
          `\r价格: ${currentPrice.toFixed(2)} | ` +
          `A权益: ${a.equity.toFixed(2)} (${a.unrealizedPnL >= 0 ? '+' : ''}${a.unrealizedPnL.toFixed(2)}) | ` +
          `B权益: ${b.equity.toFixed(2)} (${b.unrealizedPnL >= 0 ? '+' : ''}${b.unrealizedPnL.toFixed(2)}) | ` +
          `总盈亏: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`
        );
      }
    }, 3000);
  }

  // 5. 优雅退出
  const shutdown = () => {
    console.log('\n[退出] 正在停止...');
    engine.stop();
    market.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 全局异常保护 —— 防止任何未捕获错误导致进程退出
  process.on('uncaughtException', (err) => {
    console.error('[保护] 未捕获异常（进程继续运行）:', err.message);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[保护] 未捕获 Promise 拒绝（进程继续运行）:', reason);
  });

  // 保持进程运行
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
