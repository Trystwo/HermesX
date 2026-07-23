import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CycleInterval, MarginMode, QuantityType } from '../../../common/constants/enums';

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsEnum(CycleInterval)
  cycleInterval?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsEnum(QuantityType)
  quantityType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  leverage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  takeProfitPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stopLossPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxPositions?: number;

  @IsOptional()
  @IsEnum(MarginMode)
  marginMode?: string;

  @IsOptional()
  @IsString()
  apiConfigId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
