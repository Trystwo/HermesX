import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ExchangeService } from '../exchange/exchange.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly prisma: PrismaService,
  ) {}

  async getBalance(params: { strategyId?: string; environment?: string }) {
    const { strategyId, environment } = params;
    const label = strategyId ? `strategy:${strategyId}` : environment || 'TESTNET';
    let symbol: string | undefined;
    try {
      if (strategyId) {
        const strategy = await this.prisma.strategy.findUnique({
          where: { id: strategyId },
          select: { symbol: true, shortApiConfigId: true },
        });
        symbol = strategy?.symbol;

        const adapters =
          await this.exchangeService.getAdaptersForStrategy(strategyId);
        const balances = await Promise.all(
          adapters.map((ex) =>
            this.exchangeService.fetchBalance(ex, { symbol }),
          ),
        );

        if (balances.length === 1) {
          const balance = balances[0];
          return {
            totalBalance: balance.total,
            availableBalance: balance.free,
            usedBalance: balance.used,
            currency: balance.currency,
          };
        }

        const total = balances.reduce((s, b) => s + b.total, 0);
        const free = balances.reduce((s, b) => s + b.free, 0);
        const used = balances.reduce((s, b) => s + b.used, 0);
        return {
          totalBalance: total,
          availableBalance: free,
          usedBalance: used,
          currency: balances[0]?.currency ?? 'USDC',
          legs: {
            long: {
              totalBalance: balances[0].total,
              availableBalance: balances[0].free,
              usedBalance: balances[0].used,
              currency: balances[0].currency,
            },
            short: {
              totalBalance: balances[1].total,
              availableBalance: balances[1].free,
              usedBalance: balances[1].used,
              currency: balances[1].currency,
            },
          },
        };
      }

      const exchange = await this.exchangeService.getExchangeForEnvironment(
        environment || 'TESTNET',
      );
      const balance = await this.exchangeService.fetchBalance(exchange, {
        symbol,
      });

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
        currency: this.exchangeService.resolveMarginCurrency(symbol),
      };
    }
  }
}
