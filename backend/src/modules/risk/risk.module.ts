import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [ExchangeModule, GatewayModule, MarketModule],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
