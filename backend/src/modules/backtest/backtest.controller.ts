/**
 * 回测任务 API
 * 路由前缀: /api/backtests
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BacktestService } from './backtest.service';
import { CreateBacktestDto } from './dto/create-backtest.dto';
import {
  DEFAULT_CLOSE_FEE_RATE,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_OPEN_FEE_RATE,
  DEFAULT_SLIPPAGE_PCT,
  MAX_BACKTEST_DAYS,
  MAX_GRID_COMBINATIONS,
  MAX_KLINES,
} from './backtest.constants';

@Controller('backtests')
@UseGuards(JwtAuthGuard)
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  /** 回测默认值与约束（供前端展示） */
  @Get('meta')
  getMeta() {
    return {
      defaults: {
        openFeeRate: DEFAULT_OPEN_FEE_RATE,
        closeFeeRate: DEFAULT_CLOSE_FEE_RATE,
        slippagePct: DEFAULT_SLIPPAGE_PCT,
        initialBalance: DEFAULT_INITIAL_BALANCE,
        feeNote: '默认按币安 U 本位合约 Taker 0.04%（开仓/平仓）',
        slippageNote: '默认滑点为名义金额的 0.02%（2 bps），向不利方向偏移',
        equityNote:
          '净值 = 初始金额 − 累计手续费 + 已实现毛盈亏 + 未平仓盯市（按 K 线收盘价）',
      },
      limits: {
        maxBacktestDays: MAX_BACKTEST_DAYS,
        maxKlines: MAX_KLINES,
        maxGridCombinations: MAX_GRID_COMBINATIONS,
      },
    };
  }

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.backtestService.findAll(limit ? parseInt(limit, 10) : 50);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.backtestService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBacktestDto) {
    return this.backtestService.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.backtestService.remove(id);
  }
}
