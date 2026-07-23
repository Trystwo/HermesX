import { Injectable, Logger } from '@nestjs/common';
import { ExchangeService } from '../exchange/exchange.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly exchangeService: ExchangeService) {}

  async getBalance(params: { strategyId?: string; environment?: string }) {
    const { strategyId, environment } = params;
    const label = strategyId ? `strategy:${strategyId}` : environment || 'TESTNET';
    try {
      const exchange = strategyId
        ? await this.exchangeService.getExchangeForStrategy(strategyId)
        : await this.exchangeService.getExchangeForEnvironment(
            environment || 'TESTNET',
          );
      const balance = await this.exchangeService.fetchBalance(exchange);

      return {
        totalBalance: balance.total,
        availableBalance: balance.free,
        usedBalance: balance.used,
        currency: balance.currency,
      };
    } catch (e) {
      this.logger.warn(
        `Failed to fetch balance for ${label}: ${(e as Error).message}`,
      );
      return {
        totalBalance: 0,
        availableBalance: 0,
        usedBalance: 0,
        currency: 'USDT',
      };
    }
  }
}
