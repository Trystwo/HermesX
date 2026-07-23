import { Module } from '@nestjs/common';
import { StrategyEngineService } from './strategy-engine.service';
import { TpslMonitorService } from './tpsl-monitor.service';
import { OrderModule } from '../order/order.module';
import { MarketModule } from '../market/market.module';
import { RiskModule } from '../risk/risk.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [OrderModule, MarketModule, RiskModule, GatewayModule],
  providers: [StrategyEngineService, TpslMonitorService],
  exports: [StrategyEngineService, TpslMonitorService],
})
export class TradingModule {}
