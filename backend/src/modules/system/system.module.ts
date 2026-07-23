import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { TradingModule } from '../trading/trading.module';
import { PositionModule } from '../position/position.module';
import { RiskModule } from '../risk/risk.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [TradingModule, PositionModule, RiskModule, GatewayModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
