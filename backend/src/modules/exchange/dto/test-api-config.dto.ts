import { IsEnum, IsString, MinLength } from 'class-validator';
import { Environment, ExchangeName } from '../../../common/constants/enums';

export class TestApiConfigDto {
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
}
