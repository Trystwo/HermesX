import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Environment, ExchangeName } from '../../../common/constants/enums';

export class CreateApiConfigDto {
  @IsEnum(ExchangeName)
  exchange!: string;

  @IsEnum(Environment)
  environment!: string;

  @IsString()
  @MinLength(8)
  apiKey!: string;

  @IsString()
  @MinLength(8)
  apiSecret!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateApiConfigDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
