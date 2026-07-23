import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketGateway } from './market.gateway';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [ExchangeModule],
  providers: [MarketService, MarketGateway],
  exports: [MarketService],
})
export class MarketModule {}
