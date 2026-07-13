# HermesX — 多空双开回测系统

> 单账户同时开多开空，逐仓止损止盈的加密货币回测平台

## 功能特点

- **多空双开** — 每轮同时开多单和空单，对冲市场方向风险
- **逐仓止损止盈** — 每个仓位独立设置止损/止盈，触发后仅平掉该仓位
- **步骤回测** — 逐 K 线步进，实时查看每步仓位变化
- **全量回测** — 一键跑完全部数据
- **Web 仪表盘** — 实时显示余额、权益、活跃仓位、盈亏图表
- **可配置参数**
  - K 线周期（1h / 4h / 1d 等）
  - 回测天数
  - 止损% / 止盈%
  - 每单保证金
  - 杠杆倍数（最高 100x）

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npx tsx src/index.ts

# 打开浏览器
# http://localhost:3000
```

## 配置说明

启动后打开 `http://localhost:3000`，在 Web 界面设置：

| 参数 | 说明 | 默认 |
|---|---|---|
| 交易对 | K 线数据源 | btcusdt |
| 天数 | 回测数据时间范围 | 10 |
| K 线周期 | K 线时间周期 | 1 小时 |
| 止损% | 每单止损百分比 | 0.1% |
| 止盈% | 每单止盈百分比 | 3% |
| 每单金额 | 每方向开仓保证金 | $10 |
| 初始资金 | 账户初始余额 | $10000 |
| 杠杆 | 杠杆倍数 | 100x |

## 项目结构

```
src/
├── index.ts              # 入口，启动 Web 服务
├── types.ts              # 类型定义
├── config.ts             # 配置
├── account/
│   ├── Account.ts        # 旧版账户（双账户对冲）
│   └── AccountV2.ts      # 新版账户（单账户多空双开）
├── backtest/
│   ├── runner.ts         # 旧版回测引擎
│   └── runnerV2.ts       # 新版回测引擎（步骤回测）
├── exchange/
│   ├── binance.ts        # Binance 数据源
│   └── mock.ts           # 模拟数据
├── server/
│   ├── app.ts            # Web 服务（Express + WebSocket）
│   └── public/
│       ├── index.html    # 前端页面
│       ├── dashboard.js  # 前端逻辑
│       └── style.css     # 样式
└── strategy/
    └── engine.ts         # 策略引擎
```

## 技术栈

- **后端** — TypeScript, Express, WebSocket
- **前端** — 原生 JavaScript, Chart.js
- **回测引擎** — 步骤式/全量回测，支持自定义参数

## License

MIT
