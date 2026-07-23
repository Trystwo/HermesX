import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [ExchangeModule, MarketModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}