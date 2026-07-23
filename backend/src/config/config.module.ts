import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './configuration';

/**
 * 配置模块 - 全局可用
 * 通过 ConfigService 访问: configService.get('database.url')
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      load: [configuration],
    }),
  ],
  exports: [ConfigModule],
})
export class ConfigModuleSetup {}
