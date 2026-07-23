import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SystemService } from './system.service';

@Controller('system')
@UseGuards(JwtAuthGuard)
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  /** 紧急停止：熔断 + 停策略 + 尝试平掉所有 OPEN 仓位 */
  @Post('emergency-stop')
  emergencyStop() {
    return this.systemService.emergencyStop();
  }
}
