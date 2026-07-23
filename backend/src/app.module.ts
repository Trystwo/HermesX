import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModuleSetup } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { ExchangeModule } from './modules/exchange/exchange.module';
import { ApiConfigModule } from './modules/api-config/api-config.module';
import { MarketModule } from './modules/market/market.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { OrderModule } from './modules/order/order.module';
import { PositionModule } from './modules/position/position.module';
import { TradingModule } from './modules/trading/trading.module';
import { RiskModule } from './modules/risk/risk.module';
import { StatsModule } from './modules/stats/stats.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { AccountModule } from './modules/account/account.module';
import { SystemModule } from './modules/system/system.module';
import { BacktestModule } from './modules/backtest/backtest.module';

@Module({
  imports: [
    // 全局配置
    ConfigModuleSetup,
    // 定时任务
    ScheduleModule.forRoot(),
    // 公共设施
    PrismaModule,
    CryptoModule,
    // 业务模块
    AuthModule,
    ExchangeModule,
    ApiConfigModule,
    MarketModule,
    StrategyModule,
    OrderModule,
    PositionModule,
    TradingModule,
    RiskModule,
    StatsModule,
    GatewayModule,
    AccountModule,
    SystemModule,
    BacktestModule,
  ],
})
export class AppModule {}
