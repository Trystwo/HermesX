import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { RiskService } from './risk.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('config/risk')
@UseGuards(JwtAuthGuard)
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Get()
  getParams() {
    return this.riskService.getParams();
  }

  @Put()
  updateParams(@Body() body: {
    maxPositions?: number;
    maxSingleNotional?: number;
    maxTotalLossPct?: number;
    maxConsecutiveLosses?: number;
  }) {
    return this.riskService.updateParams(body);
  }

  @Post('reset-circuit-breaker')
  resetCircuitBreaker() {
    this.riskService.resetCircuitBreaker();
    return this.riskService.getParams();
  }
}
