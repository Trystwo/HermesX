import { Module } from '@nestjs/common';
import { ApiConfigController } from './api-config.controller';
import { ApiConfigService } from './api-config.service';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [ExchangeModule],
  controllers: [ApiConfigController],
  providers: [ApiConfigService],
  exports: [ApiConfigService],
})
export class ApiConfigModule {}
