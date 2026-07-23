import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * WebSocket 网关模块
 * 全局可用,其他模块通过注入 RealtimeGateway 推送实时数据
 */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class GatewayModule {}
