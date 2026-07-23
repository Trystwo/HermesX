import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { UpdateStrategyStatusDto } from './dto/update-strategy-status.dto';

@Controller('strategies')
@UseGuards(JwtAuthGuard)
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get()
  findAll(
    @Query('symbol') symbol?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.strategyService.findAll({
      symbol,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.strategyService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStrategyDto) {
    return this.strategyService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    return this.strategyService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStrategyStatusDto) {
    return this.strategyService.updateStatus(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.strategyService.remove(id);
  }
}
