import { Module } from '@nestjs/common';
import { PositionController } from './position.controller';
import { PositionService } from './position.service';
import { OrderModule } from '../order/order.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [OrderModule, ExchangeModule, MarketModule],
  controllers: [PositionController],
  providers: [PositionService],
  exports: [PositionService],
})
export class PositionModule {}
