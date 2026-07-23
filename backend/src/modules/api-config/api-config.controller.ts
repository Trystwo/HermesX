import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiConfigService } from './api-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateApiConfigDto, UpdateApiConfigDto } from '../exchange/dto/create-api-config.dto';
import { TestApiConfigDto } from '../exchange/dto/test-api-config.dto';

@Controller('config/exchange')
@UseGuards(JwtAuthGuard)
export class ApiConfigController {
  constructor(private readonly apiConfigService: ApiConfigService) {}

  @Get()
  findAll() {
    return this.apiConfigService.findAll();
  }

  @Post()
  create(@Body() dto: CreateApiConfigDto) {
    return this.apiConfigService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApiConfigDto) {
    return this.apiConfigService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apiConfigService.remove(id);
  }

  @Post('test')
  testConnection(@Body() dto: TestApiConfigDto) {
    return this.apiConfigService.testConnection(dto);
  }

  @Get('test')
  testByEnvironment(@Query('environment') environment: string) {
    return this.apiConfigService.testByEnvironment(environment || 'TESTNET');
  }

  @Get('test/:id')
  testStoredConfig(@Param('id') id: string) {
    return this.apiConfigService.testStoredConfig(id);
  }
}
