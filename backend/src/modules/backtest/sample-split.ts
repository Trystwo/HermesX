/**
 * 样本内外切分工具
 * 网格搜索仅在样本内调参；最优参数再在样本外复跑
 */

export interface SampleSplitConfig {
  /** 是否启用样本外验证 */
  enabled: boolean;
  /**
   * 切分模式：
   * - ratio：按时间比例（inSampleRatio，如 0.7 = 70% 样本内）
   * - date：按手动指定的切分时间点
   */
  mode: 'ratio' | 'date';
  /** 样本内占比 0~1，默认 0.7 */
  inSampleRatio?: number;
  /** mode=date 时的切分时间（样本内 end / 样本外 start） */
  splitAt?: Date | string;
}

export interface SampleWindow {
  inSampleStart: Date;
  inSampleEnd: Date;
  outSampleStart: Date;
  outSampleEnd: Date;
}

/**
 * 根据起止时间与切分配置，计算样本内 / 样本外窗口
 */
export function splitSampleRange(
  startTime: Date,
  endTime: Date,
  config: SampleSplitConfig,
): SampleWindow {
  if (endTime.getTime() <= startTime.getTime()) {
    throw new Error('回测结束时间必须晚于开始时间');
  }

  if (!config.enabled) {
    // 未启用时整段视为 FULL，窗口仍返回完整区间便于统一处理
    return {
      inSampleStart: startTime,
      inSampleEnd: endTime,
      outSampleStart: endTime,
      outSampleEnd: endTime,
    };
  }

  let splitMs: number;

  if (config.mode === 'date') {
    if (!config.splitAt) {
      throw new Error('样本切分模式为 date 时必须指定 splitAt');
    }
    splitMs = new Date(config.splitAt).getTime();
    if (Number.isNaN(splitMs)) {
      throw new Error('splitAt 不是有效日期');
    }
  } else {
    const ratio = config.inSampleRatio ?? 0.7;
    if (ratio <= 0 || ratio >= 1) {
      throw new Error('inSampleRatio 必须在 (0, 1) 之间');
    }
    const total = endTime.getTime() - startTime.getTime();
    splitMs = startTime.getTime() + Math.floor(total * ratio);
  }

  if (splitMs <= startTime.getTime() || splitMs >= endTime.getTime()) {
    throw new Error('样本切分点必须严格落在回测区间内部');
  }

  const splitAt = new Date(splitMs);
  return {
    inSampleStart: startTime,
    inSampleEnd: splitAt,
    outSampleStart: splitAt,
    outSampleEnd: endTime,
  };
}

/**
 * 按时间戳过滤 K 线（含 start，不含 end，避免样本内外重叠）
 */
export function filterKlinesByRange<T extends { timestamp: number }>(
  klines: T[],
  start: Date,
  end: Date,
  inclusiveEnd = false,
): T[] {
  const s = start.getTime();
  const e = end.getTime();
  return klines.filter((k) => {
    if (k.timestamp < s) return false;
    if (inclusiveEnd) return k.timestamp <= e;
    return k.timestamp < e;
  });
}
