/**
 * 创建回测任务 DTO
 * 支持单次回测与网格搜索；可选手续费、滑点、样本内外验证
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CycleInterval, QuantityType } from '../../../common/constants/enums';
import {
  BacktestJobType,
  DEFAULT_CLOSE_FEE_RATE,
  DEFAULT_GRID_TOP_N,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_OPEN_FEE_RATE,
  DEFAULT_SLIPPAGE_PCT,
} from '../backtest.constants';

class FeeConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.01)
  openFeeRate?: number = DEFAULT_OPEN_FEE_RATE;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.01)
  closeFeeRate?: number = DEFAULT_CLOSE_FEE_RATE;
}

class SlippageConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.01)
  pct?: number = DEFAULT_SLIPPAGE_PCT;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedPoints?: number;
}

class StrategyParamsDto {
  @IsEnum(CycleInterval)
  cycleInterval!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsEnum(QuantityType)
  quantityType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(125)
  leverage!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  takeProfitPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stopLossPct!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  maxPositions?: number = 10;
}

class GridParamListsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  cycleInterval?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsNumber({}, { each: true })
  @Type(() => Number)
  takeProfitPct?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsNumber({}, { each: true })
  @Type(() => Number)
  stopLossPct?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Type(() => Number)
  leverage?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsNumber({}, { each: true })
  @Type(() => Number)
  quantity?: number[];
}

class SampleSplitDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = false;

  @IsOptional()
  @IsIn(['ratio', 'date'])
  mode?: 'ratio' | 'date' = 'ratio';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  inSampleRatio?: number = 0.7;

  @IsOptional()
  @IsDateString()
  splitAt?: string;
}

export class CreateBacktestDto {
  @IsEnum(BacktestJobType)
  type!: string;

  @IsString()
  symbol!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  /**
   * 初始资金（USDT）
   * 净值 = 初始资金 - 累计手续费 + 已实现毛盈亏 + 未平仓盯市
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  initialBalance?: number = DEFAULT_INITIAL_BALANCE;

  /** 单次回测 / 网格默认策略参数 */
  @ValidateNested()
  @Type(() => StrategyParamsDto)
  params!: StrategyParamsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeeConfigDto)
  fee?: FeeConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SlippageConfigDto)
  slippage?: SlippageConfigDto;

  /** 网格搜索候选列表（type=GRID 时必填至少一个维度有 ≥2 个值） */
  @IsOptional()
  @ValidateNested()
  @Type(() => GridParamListsDto)
  grid?: GridParamListsDto;

  @IsOptional()
  @IsIn(['totalPnl', 'winRate', 'maxDrawdown', 'profitFactor', 'totalTrades'])
  sortBy?: string = 'totalPnl';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topN?: number = DEFAULT_GRID_TOP_N;

  @IsOptional()
  @ValidateNested()
  @Type(() => SampleSplitDto)
  sampleSplit?: SampleSplitDto;
}
