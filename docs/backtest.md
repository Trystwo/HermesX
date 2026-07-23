# HermesX 回测功能说明

用历史 K 线验证「按周期同时开多+开空 + 独立 TP/SL（平仓量精确等于 Q）」策略，支持手续费、滑点、参数网格搜索与样本外验证。**全程不调用真实下单接口**。

## 模块一览

| 文件 | 作用 |
|------|------|
| `backend/src/modules/backtest/backtest-engine.service.ts` | 回测引擎：周期双边开仓、精确 Q 的 TP/SL |
| `backend/src/modules/backtest/fee-calculator.ts` | 手续费计算器（开仓/平仓费率） |
| `backend/src/modules/backtest/slippage-calculator.ts` | 滑点计算器（不利方向百分比 / 固定点数） |
| `backend/src/modules/backtest/grid-search.service.ts` | 参数网格搜索调度与排序 |
| `backend/src/modules/backtest/sample-split.ts` | 样本内/外切分与 K 线过滤 |
| `backend/src/modules/backtest/kline-fetcher.service.ts` | 历史行情拉取与 Redis 缓存（公开 OHLCV） |
| `backend/src/modules/backtest/backtest.service.ts` | 任务编排与 Prisma 持久化 |
| `backend/src/modules/backtest/backtest.controller.ts` | REST API（JWT） |
| `backend/prisma/schema.prisma` | `BacktestJob` / `BacktestResult` 模型 |
| `frontend/src/pages/Backtest.tsx` | 回测页：表单、网格对比、样本内外对比、明细 |

## 默认成本假设

| 项 | 默认值 | 说明 |
|----|--------|------|
| 开仓/平仓费率 | `0.0004`（0.04%） | 对齐币安 U 本位合约 **Taker** |
| 滑点 | `0.0002`（0.02%，即 2 bps） | 按名义金额百分比，向不利方向偏移成交价 |
| 关闭手续费/滑点 | `enabled: false` | 可对比「理想成交」与「扣成本后」结果 |

约束：时间跨度 ≤ 365 天；K 线 ≤ 10_000 根；网格组合 ≤ 200。

## 依赖与启动

```bash
npm install
cp .env.example .env   # 如尚未配置
npm run docker:up
npm run db:generate
npm run db:migrate:deploy   # 含 backtest 表迁移
npm run build:backend && npm run start --workspace=backend   # :3001
npm run dev:frontend   # :5173
```

前端侧栏进入 **策略回测**，或打开 `http://localhost:5173/backtest`（需先登录）。

## API

- `GET /api/backtests/meta` — 默认费率/滑点与上限
- `GET /api/backtests` — 任务列表
- `GET /api/backtests/:id` — 任务详情（含结果）
- `POST /api/backtests` — 创建任务（异步执行）
- `DELETE /api/backtests/:id` — 删除

## 示例操作路径

### 1. 单次回测（BTCUSDT）

1. 打开「策略回测」→ **单次回测**
2. 交易对 `BTCUSDT`，周期 `5m`，选择近 7 天区间
3. 数量 `0.001`、TP `1.5%`、SL `1.0%`、杠杆 `10`
4. 保持手续费/滑点开启 → **开始回测**
5. 查看净盈亏、总手续费、总滑点成本与成交明细（假设价 → 滑点后成交价）

### 2. 带手续费 + 滑点对比

同一区间与参数跑两次：

- 第一次：手续费、滑点均开启
- 第二次：两者均关闭

验收：有手续费/滑点时 **总盈亏 ≤** 零成本时；明细手续费合计与统计一致；成交价相对触发价按不利方向偏移。

### 3. 网格搜索（至少 2×2）

1. 切换到 **网格搜索**
2. 止盈列表 `1.0,1.5`，止损列表 `0.8,1.2`（2×2）
3. 排序目标选「总盈亏」，Top N = 5
4. 提交后查看参数对比表，Top 组合高亮

组合超过 200 会返回明确错误。

### 4. 样本内外验证

1. 开启 **样本外验证**，样本内占比 `0.7`
2. 用网格搜索跑任务
3. 页面同时展示：
   - 样本内网格对比表
   - **样本内 vs 样本外** 指标对比（Top 参数在样本外自动复跑）

若关闭样本外验证，界面会提示过拟合风险；网格结果不得当作最终实盘结论。

## 复现性

相同行情数据、参数、费率、滑点与切分方式，重复运行统计一致（引擎按时间排序成交、同根 K 线同时触 TP/SL 时取保守止损优先）。
