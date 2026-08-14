import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Environment, ExchangeName } from '../../../common/constants/enums';

export class CreateApiConfigDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(ExchangeName)
  exchange!: string;

  @IsEnum(Environment)
  environment!: string;

  /**
   * Binance: API Key（必填）
   * Lighter: 可省略，后端会用 lighter:accountIndex:apiKeyIndex 占位
   */
  @ValidateIf((o) => o.exchange !== ExchangeName.LIGHTER)
  @IsString()
  @MinLength(8)
  apiKey?: string;

  /**
   * Binance: API Secret
   * Lighter: API Private Key
   */
  @IsString()
  @MinLength(8)
  apiSecret!: string;

  /** Lighter account index（可为超大整数，需 BIGINT） */
  @ValidateIf((o) => o.exchange === ExchangeName.LIGHTER)
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : Number(value),
  )
  @IsNumber()
  @Min(0)
  accountIndex?: number;

  @ValidateIf((o) => o.exchange === ExchangeName.LIGHTER)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(254)
  apiKeyIndex?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateApiConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : Number(value),
  )
  @IsNumber()
  @Min(0)
  accountIndex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(254)
  apiKeyIndex?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
