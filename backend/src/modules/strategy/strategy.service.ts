import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StrategyEngineService } from '../trading/strategy-engine.service';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { UpdateStrategyStatusDto } from './dto/update-strategy-status.dto';
import { Environment, StrategyStatus } from '../../common/constants/enums';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyEngine: StrategyEngineService,
  ) {}

  async findAll(params?: { symbol?: string; isActive?: boolean }) {
    const where: any = {};
    if (params?.symbol) where.symbol = params.symbol;
    if (params?.isActive !== undefined) where.isActive = params.isActive;

    const strategies = await this.prisma.strategy.findMany({
      where,
      include: {
        apiConfig: true,
        _count: { select: { positions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return strategies.map((s) => this.withEnvironment(s));
  }

  async findOne(id: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: {
        apiConfig: true,
        positions: {
          take: 50,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!strategy) {
      throw new NotFoundException(`Strategy ${id} not found`);
    }
    return this.withEnvironment(strategy);
  }

  async create(dto: CreateStrategyDto) {
    const strategy = await this.prisma.strategy.create({
      data: {
        name: dto.name,
        symbol: dto.symbol,
        cycleInterval: dto.cycleInterval,
        quantity: dto.quantity,
        quantityType: dto.quantityType,
        leverage: dto.leverage ?? 10,
        takeProfitPct: dto.takeProfitPct ?? 1.5,
        stopLossPct: dto.stopLossPct ?? 1.0,
        maxPositions: dto.maxPositions ?? 5,
        marginMode: dto.marginMode ?? 'ISOLATED',
        apiConfigId: dto.apiConfigId,
        isActive: dto.isActive ?? false,
        status: StrategyStatus.IDLE,
      },
      include: { apiConfig: true },
    });
    this.logger.log(`Created strategy: ${strategy.name} (${strategy.id})`);

    if (strategy.isActive) {
      this.strategyEngine.registerStrategyCron(strategy);
    }

    return this.withEnvironment(strategy);
  }

  async update(id: string, dto: UpdateStrategyDto) {
    await this.findOne(id);
    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: dto,
      include: { apiConfig: true },
    });

    // 运行中的策略参数变更后重新注册 cron（周期可能已改）
    if (strategy.isActive) {
      this.strategyEngine.registerStrategyCron(strategy);
    }

    return this.withEnvironment(strategy);
  }

  async updateStatus(id: string, dto: UpdateStrategyStatusDto) {
    const existing = await this.findOne(id);

    // 前端传 RUNNING/PAUSED/STOPPED；同时驱动 isActive 与引擎 cron
    let isActive = dto.isActive;
    let status = dto.status;

    if (status === StrategyStatus.RUNNING || status === StrategyStatus.ARMED) {
      isActive = true;
      status = StrategyStatus.RUNNING;
    } else if (
      status === StrategyStatus.PAUSED ||
      status === StrategyStatus.STOPPED ||
      status === StrategyStatus.IDLE
    ) {
      isActive = false;
    }

    // 实盘策略启动需二次确认，防止误触
    if (isActive) {
      const env =
        existing.apiConfig?.environment ??
        (
          await this.prisma.apiConfig.findFirst({
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
          })
        )?.environment;
      if (env === Environment.LIVE && !dto.confirmLive) {
        throw new BadRequestException(
          '启动实盘策略需二次确认：请传 confirmLive=true',
        );
      }
    }

    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { apiConfig: true },
    });

    if (strategy.isActive) {
      this.strategyEngine.registerStrategyCron(strategy);
      this.logger.log(`Strategy ${strategy.name} activated → cron registered`);
    } else {
      this.strategyEngine.unregisterStrategyCron(strategy.id);
      this.logger.log(`Strategy ${strategy.name} deactivated → cron unregistered`);
    }

    return this.withEnvironment(strategy);
  }

  async remove(id: string) {
    await this.findOne(id);
    this.strategyEngine.unregisterStrategyCron(id);
    await this.prisma.strategy.delete({ where: { id } });
    this.logger.log(`Deleted strategy ${id}`);
    return { id, deleted: true };
  }

  private withEnvironment<T extends { apiConfig?: { environment: string } | null }>(
    strategy: T,
  ) {
    return {
      ...strategy,
      environment: strategy.apiConfig?.environment ?? Environment.TESTNET,
    };
  }
}
