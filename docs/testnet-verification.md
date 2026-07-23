# Binance Testnet 端到端验证清单

在模拟盘完成以下步骤，确认开仓 → TP/SL 精确平 `Q` 闭环可用后再切实盘。

## 前置

1. 复制 `.env.example` 为 `.env`，填写 `DATABASE_URL`、`JWT_SECRET`、`ENCRYPTION_KEY`
2. `npm install`
3. `npm run docker:up`（Postgres + Redis）
4. `npm run db:generate && npm run db:migrate:deploy`
5. `npm run dev:backend` / `npm run dev:frontend`

## 验证步骤

| # | 步骤 | 期望结果 |
|---|------|----------|
| 1 | 注册/登录控制台 | 拿到 JWT，可进入 Dashboard |
| 2 | 设置 → 添加 Binance **TESTNET** API | 密钥加密存储；「测试」显示连接成功 |
| 3 | 创建策略：小数量 `Q`、短周期（如 5m）、绑定 Testnet 配置 | 策略出现在列表，环境为模拟盘 |
| 4 | 启动策略 | 下一周期同时开出 LONG + SHORT，各数量 = Q |
| 5 | 查看持仓 / 订单页 | 本地有 2 条 OPEN 仓位；开仓单 FILLED；TP/SL 条件单 PENDING |
| 6 | 等待 TP 或 SL 触发（或手动平仓） | 平仓数量 = Q；同方向其他周期仓位不受影响 |
| 7 | 查看统计与交易日志 | 记录 realizedPnl；连续亏损计数正确 |
| 8 | 触发紧急停止 | 所有策略暂停，OPEN 仓位尝试市价平掉 |

## 关键断言（仓位合并）

- 连续开 2 个周期后，交易所同向合并数量约为 `2Q`
- 第一个周期 TP/SL 触发时，只平 `Q`（`closePosition=false`），剩余约 `Q` 仍在

## 失败时排查

- `ExchangeService` 是否走 `testnet.binancefuture.com`
- 账户是否已切换 **Hedge Mode**
- 条件单是否误传 `reduceOnly` / `closePosition=true`
- Prisma 迁移是否已 `migrate deploy`
