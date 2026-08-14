import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ExchangeService } from '../exchange/exchange.service';
import { CreateApiConfigDto, UpdateApiConfigDto } from '../exchange/dto/create-api-config.dto';
import { TestApiConfigDto } from '../exchange/dto/test-api-config.dto';

@Injectable()
export class ApiConfigService {
  private readonly logger = new Logger(ApiConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly exchangeService: ExchangeService,
  ) {}

  /**
   * 列出所有配置(返回时隐藏密钥明文)
   */
  async findAll() {
    const configs = await this.prisma.apiConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return configs.map((c) => this.maskSecrets(c));
  }

  /**
   * 创建配置 - 加密存储密钥
   */
  async create(dto: CreateApiConfigDto) {
    if (dto.exchange === 'LIGHTER') {
      if (dto.accountIndex == null || dto.apiKeyIndex == null) {
        throw new BadRequestException(
          'Lighter 配置需要 accountIndex 与 apiKeyIndex',
        );
      }
    }

    const apiKeyPlain =
      dto.apiKey?.trim() ||
      (dto.exchange === 'LIGHTER'
        ? `lighter:${dto.accountIndex}:${dto.apiKeyIndex}`
        : '');
    if (!apiKeyPlain) {
      throw new BadRequestException('apiKey 不能为空');
    }

    const encryptedKey = this.cryptoService.encrypt(apiKeyPlain);
    const encryptedSecret = this.cryptoService.encrypt(dto.apiSecret);

    const config = await this.prisma.apiConfig.create({
      data: {
        name: dto.name.trim(),
        exchange: dto.exchange,
        environment: dto.environment,
        apiKey: encryptedKey,
        apiSecret: encryptedSecret,
        accountIndex:
          dto.accountIndex != null ? BigInt(dto.accountIndex) : null,
        apiKeyIndex: dto.apiKeyIndex ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    // 清除交易所实例缓存,使新配置生效
    this.exchangeService.clearCache(config.id);

    this.logger.log(`Created ApiConfig: ${config.name} (${dto.exchange}:${dto.environment})`);
    return this.maskSecrets(config);
  }

  /**
   * 更新配置
   */
  async update(id: string, dto: UpdateApiConfigDto) {
    const existing = await this.prisma.apiConfig.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ApiConfig ${id} not found`);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.apiKey) data.apiKey = this.cryptoService.encrypt(dto.apiKey);
    if (dto.apiSecret) data.apiSecret = this.cryptoService.encrypt(dto.apiSecret);
    if (dto.accountIndex !== undefined) {
      data.accountIndex =
        dto.accountIndex == null ? null : BigInt(dto.accountIndex);
    }
    if (dto.apiKeyIndex !== undefined) data.apiKeyIndex = dto.apiKeyIndex;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const config = await this.prisma.apiConfig.update({ where: { id }, data });
    this.exchangeService.clearCache(id);

    return this.maskSecrets(config);
  }

  /**
   * 删除配置
   */
  async remove(id: string) {
    const existing = await this.prisma.apiConfig.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ApiConfig ${id} not found`);
    }
    await this.prisma.apiConfig.delete({ where: { id } });
    this.exchangeService.clearCache(id);
    this.logger.log(`Deleted ApiConfig ${id}`);
    return { id, deleted: true };
  }

  /**
   * 测试 API 连通性(不落库)
   */
  async testConnection(dto: TestApiConfigDto): Promise<{ success: boolean; message: string; latency?: number }> {
    return this.exchangeService.testConnectionDetailed({
      exchange: dto.exchange,
      environment: dto.environment,
      apiKey: dto.apiKey || `lighter:${dto.accountIndex}:${dto.apiKeyIndex}`,
      apiSecret: dto.apiSecret,
      accountIndex: dto.accountIndex,
      apiKeyIndex: dto.apiKeyIndex,
    });
  }

  /**
   * 测试已存储配置的连通性
   */
  async testStoredConfig(id: string): Promise<{ success: boolean; message: string; latency?: number }> {
    const config = await this.prisma.apiConfig.findUnique({ where: { id } });
    if (!config) {
      throw new NotFoundException(`ApiConfig ${id} not found`);
    }
    const apiKey = this.cryptoService.decrypt(config.apiKey);
    const apiSecret = this.cryptoService.decrypt(config.apiSecret);
    return this.exchangeService.testConnectionDetailed({
      exchange: config.exchange,
      environment: config.environment,
      apiKey,
      apiSecret,
      accountIndex:
        config.accountIndex != null ? Number(config.accountIndex) : undefined,
      apiKeyIndex: config.apiKeyIndex ?? undefined,
    });
  }

  /**
   * 按 environment 测试已存储配置
   */
  async testByEnvironment(environment: string): Promise<{ success: boolean; message: string; latency?: number }> {
    const config = await this.prisma.apiConfig.findFirst({
      where: { environment, isActive: true },
    });
    if (!config) {
      return { success: false, message: `未找到 ${environment} 环境的 API 配置` };
    }
    const apiKey = this.cryptoService.decrypt(config.apiKey);
    const apiSecret = this.cryptoService.decrypt(config.apiSecret);
    return this.exchangeService.testConnectionDetailed({
      exchange: config.exchange,
      environment,
      apiKey,
      apiSecret,
      accountIndex:
        config.accountIndex != null ? Number(config.accountIndex) : undefined,
      apiKeyIndex: config.apiKeyIndex ?? undefined,
    });
  }

  /**
   * 隐藏密钥明文,只返回前几位 + 掩码
   */
  private maskSecrets(config: any) {
    const apiKeyMasked = this.mask(config.apiKey);
    const apiSecretMasked = this.mask(config.apiSecret);
    return {
      ...config,
      // BigInt 无法 JSON 序列化，转成 number（Lighter index 在 Number.MAX_SAFE_INTEGER 内）
      accountIndex:
        config.accountIndex != null ? Number(config.accountIndex) : null,
      apiKey: apiKeyMasked,
      apiSecret: apiSecretMasked,
      apiKeyMasked,
      apiSecretMasked,
    };
  }

  private mask(value: string): string {
    if (!value || value.length < 8) return '***';
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  }
}
