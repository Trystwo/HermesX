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
import { Environment, ExchangeName, StrategyStatus } from '../../common/constants/enums';

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
        shortApiConfig: true,
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
        shortApiConfig: true,
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
    await this.validateApiConfigBinding(dto.apiConfigId, dto.shortApiConfigId);

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
        localAutoCloseEnabled: dto.localAutoCloseEnabled ?? false,
        apiConfigId: dto.apiConfigId,
        shortApiConfigId: dto.shortApiConfigId,
        isActive: dto.isActive ?? false,
        status: StrategyStatus.IDLE,
      },
      include: { apiConfig: true, shortApiConfig: true },
    });
    this.logger.log(`Created strategy: ${strategy.name} (${strategy.id})`);

    if (strategy.isActive) {
      this.strategyEngine.registerStrategyCron(strategy);
    }

    return this.withEnvironment(strategy);
  }

  async update(id: string, dto: UpdateStrategyDto) {
    const existing = await this.findOne(id);
    const nextLong =
      dto.apiConfigId !== undefined ? dto.apiConfigId : existing.apiConfigId;
    const nextShort =
      dto.shortApiConfigId !== undefined
        ? dto.shortApiConfigId
        : (existing as { shortApiConfigId?: string | null }).shortApiConfigId;
    await this.validateApiConfigBinding(nextLong, nextShort);

    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: dto,
      include: { apiConfig: true, shortApiConfig: true },
    });

    if (strategy.isActive) {
      this.strategyEngine.registerStrategyCron(strategy);
    }

    return this.withEnvironment(strategy);
  }

  async updateStatus(id: string, dto: UpdateStrategyStatusDto) {
    const existing = await this.findOne(id);

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
      await this.validateApiConfigBinding(
        existing.apiConfigId,
        (existing as { shortApiConfigId?: string | null }).shortApiConfigId,
      );
    }

    const strategy = await this.prisma.strategy.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { apiConfig: true, shortApiConfig: true },
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

  /**
   * Lighter 必须绑定两个不同子账户；Binance 可只用多腿配置。
   */
  private async validateApiConfigBinding(
    apiConfigId?: string | null,
    shortApiConfigId?: string | null,
  ): Promise<void> {
    if (!apiConfigId) {
      if (shortApiConfigId) {
        throw new BadRequestException('绑定空腿配置前请先选择多腿 API 配置');
      }
      return;
    }

    const longCfg = await this.prisma.apiConfig.findUnique({
      where: { id: apiConfigId },
    });
    if (!longCfg) {
      throw new BadRequestException(`API 配置不存在: ${apiConfigId}`);
    }

    if (longCfg.exchange === ExchangeName.LIGHTER) {
      if (!shortApiConfigId) {
        throw new BadRequestException(
          'Lighter 不支持同账户双向持仓，请另选一个子账户作为空腿 API 配置',
        );
      }
      if (shortApiConfigId === apiConfigId) {
        throw new BadRequestException('多腿与空腿必须使用不同的 API 配置');
      }
      const shortCfg = await this.prisma.apiConfig.findUnique({
        where: { id: shortApiConfigId },
      });
      if (!shortCfg) {
        throw new BadRequestException(`空腿 API 配置不存在: ${shortApiConfigId}`);
      }
      if (shortCfg.exchange !== ExchangeName.LIGHTER) {
        throw new BadRequestException('空腿配置必须同为 Lighter');
      }
      if (shortCfg.environment !== longCfg.environment) {
        throw new BadRequestException('多腿与空腿 API 环境必须一致');
      }
      if (
        longCfg.accountIndex != null &&
        shortCfg.accountIndex != null &&
        Number(longCfg.accountIndex) === Number(shortCfg.accountIndex)
      ) {
        throw new BadRequestException(
          '多腿与空腿必须使用不同的 Lighter accountIndex（子账户）',
        );
      }
      return;
    }

    if (shortApiConfigId) {
      throw new BadRequestException(
        `${longCfg.exchange} 使用同账户双向持仓，无需绑定空腿 API 配置`,
      );
    }
  }

  private withEnvironment<
    T extends {
      apiConfig?: Record<string, any> | null;
      shortApiConfig?: Record<string, any> | null;
    },
  >(strategy: T) {
    return {
      ...strategy,
      apiConfig: this.serializeApiConfig(strategy.apiConfig),
      shortApiConfig: this.serializeApiConfig(
        (strategy as any).shortApiConfig ?? null,
      ),
      environment: strategy.apiConfig?.environment ?? Environment.TESTNET,
    };
  }

  /** 避免嵌套 ApiConfig.accountIndex(BigInt) 导致接口 500 */
  private serializeApiConfig(config: Record<string, any> | null | undefined) {
    if (!config) return null;
    const { apiKey, apiSecret, accountIndex, ...rest } = config;
    return {
      ...rest,
      accountIndex: accountIndex != null ? Number(accountIndex) : null,
      apiKeyMasked:
        typeof apiKey === 'string' && apiKey.length >= 8
          ? `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
          : '***',
      apiSecretMasked:
        typeof apiSecret === 'string' && apiSecret.length >= 8
          ? `${apiSecret.slice(0, 4)}****${apiSecret.slice(-4)}`
          : '***',
    };
  }
}
