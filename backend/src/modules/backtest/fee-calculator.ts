/**
 * 手续费计算器
 * 按成交名义金额 × 费率计算开仓/平仓手续费；统计与明细均为扣费后结果
 */

export interface FeeConfig {
  /** 是否计入手续费；false 时费率为 0（理想成交对比） */
  enabled: boolean;
  /** 开仓费率，例如 0.0004 = 0.04% */
  openFeeRate: number;
  /** 平仓费率 */
  closeFeeRate: number;
}

export interface FeeBreakdown {
  openFee: number;
  closeFee: number;
  totalFee: number;
}

/**
 * 计算开仓手续费：名义金额 × 开仓费率
 */
export function calcOpenFee(price: number, quantity: number, config: FeeConfig): number {
  if (!config.enabled || config.openFeeRate <= 0) return 0;
  return price * quantity * config.openFeeRate;
}

/**
 * 计算平仓手续费：名义金额 × 平仓费率
 */
export function calcCloseFee(price: number, quantity: number, config: FeeConfig): number {
  if (!config.enabled || config.closeFeeRate <= 0) return 0;
  return price * quantity * config.closeFeeRate;
}

/**
 * 汇总开平仓手续费
 */
export function calcFeeBreakdown(
  openPrice: number,
  closePrice: number,
  quantity: number,
  config: FeeConfig,
): FeeBreakdown {
  const openFee = calcOpenFee(openPrice, quantity, config);
  const closeFee = calcCloseFee(closePrice, quantity, config);
  return {
    openFee,
    closeFee,
    totalFee: openFee + closeFee,
  };
}
