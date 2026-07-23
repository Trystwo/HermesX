# HermesX

数字货币 USDT 永续合约**周期对冲**交易系统：按固定周期同时开多 + 开空，并为每周期仓位设置独立 TP/SL；平仓数量精确等于开仓量 `Q`（`closePosition=false`），避免交易所 Hedge 模式下仓位合并导致整仓被平。

详细技术方案见 [项目书.md](./项目书.md)。Testnet 验收步骤见 [docs/testnet-verification.md](./docs/testnet-verification.md)。

## 架构

```
React SPA  ──REST / Socket.io──►  NestJS API
                                    ├── StrategyEngine + TpslMonitor
                                    ├── Order / Position / Risk
                                    └── ExchangeService (ccxt → Binance)
                                         │
                              PostgreSQL + Redis
```

## 技术栈

| 层 | 技术 |
|----|------|
| Monorepo | npm workspaces（`backend` + `frontend`） |
| 后端 | NestJS 10、Prisma 5、PostgreSQL 16、Redis 7、ccxt、JWT |
| 定时 | `@nestjs/schedule`（周期建仓 / TP-SL / 风控） |
| 前端 | React 18、Vite 5、Tailwind、Zustand、React Query、Socket.io |

## 快速开始

```bash
npm install
cp .env.example .env   # 填写 DATABASE_URL、JWT_SECRET、ENCRYPTION_KEY
npm run docker:up      # Postgres + Redis（开发 compose）
npm run db:generate
npm run db:migrate:deploy   # 新库；若库已由 db:push 建表，先执行 npm run db:migrate:baseline
npm run dev:backend    # :3001
npm run start --workspace=backend
npm run dev:frontend   # :5173
```

生产：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 数据库迁移

- 新环境：`npm run db:migrate:deploy`
- 旧库（曾用 `db:push`）：`npm run db:migrate:baseline` 后再 `deploy`
- 开发迭代：`npm run db:migrate`

## 安全与实盘

- Testnet / Live API 配置分环境存储，未绑定策略时默认走 `DEFAULT_ENVIRONMENT`（建议 `TESTNET`）
- 顶部实盘红条；切换实盘、添加实盘 API、启动实盘策略均需二次确认
- `POST /api/system/emergency-stop`：熔断 + 停策略 + 尝试平掉所有 OPEN 仓位

## 回测

侧栏「策略回测」或见 [docs/backtest.md](./docs/backtest.md)：历史 K 线验证周期对冲策略，支持手续费、滑点、参数网格与样本外验证（**不下单**）。

默认成本：Taker 费率 0.04%、滑点 0.02%；可关闭后与理想成交对比。