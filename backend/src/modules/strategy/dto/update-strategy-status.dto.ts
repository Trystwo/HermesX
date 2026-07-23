import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateStrategyStatusDto {
  @IsOptional()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** 启动绑定 LIVE API 的策略时必须为 true（二次确认） */
  @IsOptional()
  @IsBoolean()
  confirmLive?: boolean;
}
