import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [ExchangeModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
