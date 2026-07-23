import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username 只能包含字母、数字、下划线',
  })
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password!: string;
}
