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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('positions')
@UseGuards(JwtAuthGuard)
export class PositionController {
  constructor(private readonly positionService: PositionService) {}

  @Get()
  findAll(
    @Query('strategyId') strategyId?: string,
    @Query('status') status?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.positionService.findAll({ strategyId, status, cycleId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.positionService.findOne(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.positionService.closePosition(id);
  }

  @Post('close-all')
  closeAll(@Body('strategyId') strategyId?: string) {
    return this.positionService.closeAll(strategyId);
  }

  @Post('reconcile/:strategyId')
  reconcile(@Param('strategyId') strategyId: string) {
    return this.positionService.reconcile(strategyId);
  }
}
