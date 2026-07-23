import { CycleInterval } from '../../common/constants/enums';

/**
 * 周期间隔转 cron 表达式
 * - 1m  -> 每1分钟
 * - 3m  -> 每3分钟
 * - 5m  -> 每5分钟
 * - 15m -> 每15分钟
 * - 1h  -> 每小时
 * - 4h  -> 每4小时
 * - 1d  -> 每天
 */
export function cycleIntervalToCron(interval: string): string {
  switch (interval) {
    case CycleInterval.M1:
      return '* * * * *';
    case CycleInterval.M3:
      return '*/3 * * * *';
    case CycleInterval.M5:
      return '*/5 * * * *';
    case CycleInterval.M15:
      return '*/15 * * * *';
    case CycleInterval.H1:
      return '0 * * * *';
    case CycleInterval.H4:
      return '0 */4 * * *';
    case CycleInterval.D1:
      return '0 0 * * *';
    default:
      throw new Error(`Unsupported cycle interval: ${interval}`);
  }
}

/**
 * 将 ccxt/Binance 的 interval(1m,5m,15m,1h,4h,1d) 转为 cron
 */
export function klineIntervalToCron(interval: string): string {
  const map: Record<string, string> = {
    '1m': '* * * * *',
    '3m': '*/3 * * * *',
    '5m': '*/5 * * * *',
    '15m': '*/15 * * * *',
    '30m': '*/30 * * * *',
    '1h': '0 * * * *',
    '2h': '0 */2 * * *',
    '4h': '0 */4 * * *',
    '6h': '0 */6 * * *',
    '8h': '0 */8 * * *',
    '12h': '0 */12 * * *',
    '1d': '0 0 * * *',
    '3d': '0 0 */3 * *',
    '1w': '0 0 * * 0',
    '1M': '0 0 1 * *',
  };
  return map[interval] || cycleIntervalToCron(interval);
}

/**
 * 生成周期 ID(用于同周期多+空配对)
 */
export function generateCycleId(interval: string, time: Date = new Date()): string {
  const iso = time.toISOString();
  // 精确到分钟(1m/3m/5m/15m)或小时(1h/4h/1d)
  switch (interval) {
    case CycleInterval.M1:
    case CycleInterval.M3:
    case CycleInterval.M5:
    case CycleInterval.M15:
      return `${interval}:${iso.slice(0, 16)}`; // YYYY-MM-DDTHH:MM
    case CycleInterval.H1:
    case CycleInterval.H4:
    case CycleInterval.D1:
      return `${interval}:${iso.slice(0, 13)}`; // YYYY-MM-DDTHH
    default:
      return `${interval}:${iso.slice(0, 16)}`;
  }
}
