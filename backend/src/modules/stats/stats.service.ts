import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PositionStatus } from '../../common/constants/enums';

export interface StatsResult {
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number; // 盈亏比 = 总盈利 / 总亏损
  maxDrawdown: number; // 最大回撤
}

/**
 * 统计服务
 * 按日/周/月统计盈亏、胜率、最大回撤、盈亏比
 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStats(period: 'day' | 'week' | 'month' = 'day', strategyId?: string): Promise<StatsResult> {
    const { start, end } = this.getPeriodRange(period);

    const where: any = {
      closedAt: { gte: start, lte: end },
      status: { in: [PositionStatus.TP_HIT, PositionStatus.SL_HIT, PositionStatus.CLOSED, PositionStatus.MANUAL] },
      realizedPnl: { not: null },
    };
    if (strategyId) where.strategyId = strategyId;

    const positions = await this.prisma.position.findMany({
      where,
      orderBy: { closedAt: 'asc' },
      select: {
        id: true,
        realizedPnl: true,
        closedAt: true,
      },
    });

    return this.computeStats(period, positions);
  }

  /**
   * 获取多周期对比统计
   */
  async getMultiPeriodStats(strategyId?: string): Promise<{
    daily: StatsResult;
    weekly: StatsResult;
    monthly: StatsResult;
  }> {
    const [daily, weekly, monthly] = await Promise.all([
      this.getStats('day', strategyId),
      this.getStats('week', strategyId),
      this.getStats('month', strategyId),
    ]);
    return { daily, weekly, monthly };
  }

  private computeStats(
    period: string,
    positions: Array<{ id: string; realizedPnl: number | null; closedAt: Date | null }>,
  ): StatsResult {
    const trades = positions.filter((p) => p.realizedPnl !== null) as Array<{
      id: string;
      realizedPnl: number;
      closedAt: Date | null;
    }>;

    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.realizedPnl > 0);
    const losses = trades.filter((t) => t.realizedPnl < 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.realizedPnl, 0));

    const maxWin = wins.length > 0 ? Math.max(...wins.map((t) => t.realizedPnl)) : 0;
    const maxLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.realizedPnl)) : 0;

    // 计算最大回撤
    let peak = 0;
    let cumulative = 0;
    let maxDrawdown = 0;
    for (const t of trades) {
      cumulative += t.realizedPnl;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return {
      period,
      totalTrades,
      wins: wins.length,
      losses: losses.length,
      winRate: totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0,
      totalPnl,
      avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
      maxWin,
      maxLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown,
    };
  }

  private getPeriodRange(period: 'day' | 'week' | 'month'): { start: Date; end: Date } {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);

    switch (period) {
      case 'day':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
        break;
      case 'month':
        start.setMonth(now.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        break;
    }

    return { start, end };
  }

  /**
   * 获取累计统计
   */
  async getCumulativeStats(strategyId?: string): Promise<StatsResult> {
    const where: any = {
      status: { in: [PositionStatus.TP_HIT, PositionStatus.SL_HIT, PositionStatus.CLOSED, PositionStatus.MANUAL] },
      realizedPnl: { not: null },
    };
    if (strategyId) where.strategyId = strategyId;

    const positions = await this.prisma.position.findMany({
      where,
      orderBy: { closedAt: 'asc' },
      select: { id: true, realizedPnl: true, closedAt: true },
    });

    return this.computeStats('cumulative', positions);
  }
}
