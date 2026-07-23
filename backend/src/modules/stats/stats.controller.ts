import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('trades/stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  getStats(
    @Query('period') period?: 'day' | 'week' | 'month',
    @Query('strategyId') strategyId?: string,
  ) {
    return this.statsService.getStats(period || 'day', strategyId);
  }

  @Get('multi')
  getMultiPeriodStats(@Query('strategyId') strategyId?: string) {
    return this.statsService.getMultiPeriodStats(strategyId);
  }

  @Get('cumulative')
  getCumulativeStats(@Query('strategyId') strategyId?: string) {
    return this.statsService.getCumulativeStats(strategyId);
  }
}
