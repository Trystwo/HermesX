# Plan v2 — 单账户多空双开 + 逐仓止损 + 步骤回测

## 策略变化

| 项目 | v1（当前） | v2（目标） |
|---|---|---|
| 账户 | 双账户（A多/B空） | **单账户**，同时持有多单和空单 |
| 开仓时机 | 首根 K 线开一次 | **每根 K 线**同时开一个多单 lot + 一个空单 lot |
| 加减仓 | 赚了加/亏了减（合并均价） | 不再加减，**每步固定开一对新 lot** |
| 止损 | 无 | 每个 lot **独立止损**，到了就平掉它 |
| 回测 | 一次性跑完 | **步骤式**：点一下走一根，也可一次跑完 |

---

## Phase 1 — 数据模型 (types.ts)

- 新增 `Lot` 接口
  ```typescript
  interface Lot {
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;      // 币数量
    margin: number;        // 占用的保证金
  }
  ```
- 新增 `BacktestState` 接口（回测状态机）
- 更新 `BacktestSnapshot`：去掉 A/B 双账户字段
- 更新 `AccountSnapshot`：添加 `lots` 数组

## Phase 2 — Account 重写 (account/Account.ts)

不再分 A/B 两个账户，改为**一个账户管理多空两个 lot 列表**：

- `balance: number` — 现金余额
- `longLots: Lot[]` — 多单列表
- `shortLots: Lot[]` — 空单列表

### 方法

| 方法 | 说明 |
|---|---|
| `openBoth(price, marginPerSide)` | 同时开一个多单 lot + 一个空单 lot，各用 `marginPerSide` 保证金 |
| `checkStopLoss(prevHigh, prevLow, stopLossPct)` | 遍历所有 lots，用前一根 K 线的 high/low 判断是否触止损 |
| `closeLot(lot, price)` | 平掉指定 lot，计算已实现盈亏入账 |
| `getUnrealizedPnL(price)` | 所有 lots 的浮动盈亏总和 |
| `getEquity(price)` | `balance + 浮动盈亏` |
| `getLongPnL(price)` | 仅多单的浮动盈亏 |
| `getShortPnL(price)` | 仅空单的浮动盈亏 |

### 止损逻辑

```
多单 lot: 若 prev.low <= lot.entryPrice * (1 - stopLossPct) → 止损平仓
空单 lot: 若 prev.high >= lot.entryPrice * (1 + stopLossPct) → 止损平仓
```

### 每根 K 线执行流程

```
1. 开仓: 在 candle.open 同时开一个多单 lot + 一个空单 lot
2. 止损: 用 prev candle 的 high/low 检查所有已有 lots，触发的平掉
3. 记录快照
```

## Phase 3 — 回测状态机 (backtest/runner.ts)

重写为步骤式 API：

```typescript
function initBacktest(params): BacktestState
function stepBacktest(state): BacktestState
function runAllBacktest(state): BacktestState
```

## Phase 4 — 后端 API (server/app.ts)

| 端点 | 操作 |
|---|---|
| `POST /api/backtest/v2/init` | 传入配置参数，返回 state |
| `POST /api/backtest/v2/step` | 传入 state，前进一根，返回新 state |
| `POST /api/backtest/v2/runAll` | 传入 state，跑完剩余，返回最终 state |

## Phase 5 — 前端 UI (index.html + dashboard.js)

配置 + 多空仓位两栏显示 + 步骤控制按钮。
