import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { Environment, ExchangeName } from '../../../common/constants/enums';

export class TestApiConfigDto {
  @IsEnum(ExchangeName)
  exchange!: string;

  @IsEnum(Environment)
  environment!: string;

  @ValidateIf((o) => o.exchange !== ExchangeName.LIGHTER)
  @IsString()
  @MinLength(8)
  apiKey?: string;

  @IsString()
  @MinLength(8)
  apiSecret!: string;

  @ValidateIf((o) => o.exchange === ExchangeName.LIGHTER)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  accountIndex?: number;

  @ValidateIf((o) => o.exchange === ExchangeName.LIGHTER)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(254)
  apiKeyIndex?: number;
}
