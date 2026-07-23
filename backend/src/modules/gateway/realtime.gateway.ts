import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * 实时数据推送网关
 *
 * 推送事件:
 * - market:ticker     行情更新
 * - position:update   仓位更新(开仓/平仓/状态变化)
 * - order:fill        订单成交
 * - strategy:status   策略状态变化
 * - pnl:snapshot      盈亏快照
 * - alert:risk        风控告警
 */
@WebSocketGateway({
  namespace: 'realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('Realtime gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Realtime client connected: ${client.id}`);
    client.emit('connected', { message: 'Connected to HermesX realtime' });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Realtime client disconnected: ${client.id}`);
  }

  /**
   * 推送仓位更新
   */
  broadcastPositionUpdate(data: {
    type: string;
    position: any;
  }): void {
    this.server.emit('position:update', data);
  }

  /**
   * 推送订单成交
   */
  broadcastOrderFill(data: {
    positionId: string;
    type: string;
    price: number;
    timestamp: number;
  }): void {
    this.server.emit('order:fill', data);
  }

  /**
   * 推送策略状态
   */
  broadcastStrategyStatus(data: {
    strategyId: string;
    status: string;
    cycleId?: string;
    timestamp?: number;
  }): void {
    this.server.emit('strategy:status', data);
  }

  /**
   * 推送盈亏快照
   */
  broadcastPnlSnapshot(data: {
    positionId: string;
    strategyId: string;
    currentPrice: number;
    unrealizedPnl: number;
    timestamp: number;
  }): void {
    this.server.emit('pnl:snapshot', data);
  }

  /**
   * 推送风控告警
   */
  broadcastAlert(data: {
    type: string;
    strategyId?: string;
    reason: string;
    timestamp: number;
  }): void {
    this.server.emit('alert:risk', data);
  }

  /**
   * 推送行情 ticker(由 MarketService 调用)
   */
  broadcastTicker(data: {
    symbol: string;
    lastPrice: number;
    bid: number;
    ask: number;
    timestamp: number;
  }): void {
    this.server.emit('market:ticker', data);
  }
}
