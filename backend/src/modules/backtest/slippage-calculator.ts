/**
 * 滑点计算器
 * 按成交名义金额百分比（或可选固定点数）向不利方向偏移成交价
 */

export interface SlippageConfig {
  /** 是否启用滑点；false 时成交价 = 假设价 */
  enabled: boolean;
  /** 按名义金额的百分比，例如 0.0002 = 0.02% */
  pct: number;
  /** 可选：固定点数（加在百分比偏移之后） */
  fixedPoints?: number;
}

export type TradeSide = 'LONG' | 'SHORT';
export type TradeAction = 'OPEN' | 'CLOSE';

export interface SlippageResult {
  /** 策略假设价（触发价 / 开仓参考价） */
  assumedPrice: number;
  /** 滑点后实际成交价 */
  fillPrice: number;
  /** 滑点成本（绝对金额，始终 ≥ 0） */
  slippageCost: number;
}

/**
 * 计算不利方向滑点后的成交价
 *
 * 开仓：LONG 买入更贵；SHORT 卖出更便宜
 * 平仓：LONG 卖出更便宜；SHORT 买入更贵（回补）
 */
export function applySlippage(
  assumedPrice: number,
  quantity: number,
  side: TradeSide,
  action: TradeAction,
  config: SlippageConfig,
): SlippageResult {
  if (!config.enabled || assumedPrice <= 0) {
    return { assumedPrice, fillPrice: assumedPrice, slippageCost: 0 };
  }

  const pct = Math.max(0, config.pct || 0);
  const fixed = Math.max(0, config.fixedPoints || 0);

  // 不利方向：开多/平空 → 价格上移；开空/平多 → 价格下移
  const buySide =
    (action === 'OPEN' && side === 'LONG') || (action === 'CLOSE' && side === 'SHORT');

  let fillPrice: number;
  if (buySide) {
    fillPrice = assumedPrice * (1 + pct) + fixed;
  } else {
    fillPrice = assumedPrice * (1 - pct) - fixed;
    if (fillPrice <= 0) fillPrice = assumedPrice * (1 - pct);
  }

  // 滑点成本 = |成交价 - 假设价| × 数量
  const slippageCost = Math.abs(fillPrice - assumedPrice) * quantity;

  return { assumedPrice, fillPrice, slippageCost };
}
