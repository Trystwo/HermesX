import { Controller, Get, Query } from '@nestjs/common';
import { AccountService } from './account.service';

@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('balance')
  async getBalance(
    @Query('strategyId') strategyId?: string,
    @Query('environment') environment?: string,
  ) {
    return this.accountService.getBalance({ strategyId, environment });
  }
}
