import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StrategyEngineService } from '../trading/strategy-engine.service';
import { PositionService } from '../position/position.service';
import { RiskService } from '../risk/risk.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { StrategyStatus } from '../../common/constants/enums';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyEngine: StrategyEngineService,
    private readonly positionService: PositionService,
    private readonly riskService: RiskService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async emergencyStop(): Promise<{
    success: boolean;
    message: string;
    pausedStrategies: number;
    closedPositions: number;
  }> {
    this.logger.error('EMERGENCY STOP triggered');

    this.riskService.triggerCircuitBreaker('Manual emergency stop');

    const activeStrategies = await this.prisma.strategy.findMany({
      where: { isActive: true },
    });

    for (const s of activeStrategies) {
      this.strategyEngine.unregisterStrategyCron(s.id);
      await this.prisma.strategy.update({
        where: { id: s.id },
        data: { isActive: false, status: StrategyStatus.PAUSED },
      });
    }

    const closeResult = await this.positionService.closeAll();

    this.gateway.broadcastAlert({
      type: 'EMERGENCY_STOP',
      reason: `Manual emergency stop (paused=${activeStrategies.length}, closed=${closeResult.closed})`,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: `紧急停止完成：已暂停 ${activeStrategies.length} 个策略，平仓 ${closeResult.closed} 个持仓`,
      pausedStrategies: activeStrategies.length,
      closedPositions: closeResult.closed,
    };
  }
}
