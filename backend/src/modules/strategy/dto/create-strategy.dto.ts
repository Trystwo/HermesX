import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CycleInterval,
  MarginMode,
  QuantityType,
} from '../../../common/constants/enums';

export class CreateStrategyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @IsEnum(CycleInterval)
  cycleInterval!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsEnum(QuantityType)
  quantityType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  leverage?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  takeProfitPct?: number = 1.5;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stopLossPct?: number = 1.0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxPositions?: number = 5;

  @IsOptional()
  @IsEnum(MarginMode)
  marginMode?: string = MarginMode.ISOLATED;

  @IsOptional()
  @IsString()
  apiConfigId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = false;
}
