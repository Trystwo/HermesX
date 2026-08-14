import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PositionService } from './position.service';
import { TpslMonitorService } from '../trading/tpsl-monitor.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionController {
  constructor(
    private readonly positionService: PositionService,
    private readonly tpslMonitorService: TpslMonitorService,
  ) {}

  @Get()
  findAll(
    @Query('strategyId') strategyId?: string,
    @Query('status') status?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.positionService.findAll({ strategyId, status, cycleId });
  }

  @Post('close-all')
  closeAll(@Body('strategyId') strategyId?: string) {
    return this.positionService.closeAll(strategyId);
  }

  @Post('place-tpsl-missing')
  placeTpSlMissing(@Body('strategyId') strategyId?: string) {
    return this.positionService.placeTpSlMissing(strategyId);
  }

  /** 检查孤儿条件单（交易所挂着但本地无 PENDING / 仓位已平本地仍 PENDING） */
  @Post('orphan-orders/check')
  checkOrphanOrders(@Body('strategyId') strategyId?: string) {
    return this.positionService.checkOrphanOrders(strategyId);
  }

  /** 确认清理孤儿条件单；可传 algoIds 只清指定项 */
  @Post('orphan-orders/cleanup')
  cleanupOrphanOrders(
    @Body('strategyId') strategyId?: string,
    @Body('algoIds') algoIds?: string[],
  ) {
    return this.positionService.cleanupOrphanOrders(strategyId, algoIds);
  }

  @Post('reconcile/:strategyId')
  reconcile(@Param('strategyId') strategyId: string) {
    return this.positionService.reconcile(strategyId);
  }

  /** 手动触发条件单对账：同步已成交 TP/SL，撤销残留挂单 */
  @Post('sync-conditional/:strategyId')
  syncConditional(@Param('strategyId') strategyId: string) {
    return this.tpslMonitorService.syncStrategyConditionalFills(strategyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.positionService.findOne(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.positionService.closePosition(id);
  }

  @Post(':id/place-tpsl')
  placeTpSl(@Param('id') id: string) {
    return this.positionService.placeTpSl(id);
  }
}
