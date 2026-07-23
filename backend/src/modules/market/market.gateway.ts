import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MarketService } from './market.service';

/**
 * 行情 WebSocket 网关
 * 客户端可发送 'subscribe' 事件订阅 symbol,服务端推送 'market:ticker'
 */
@WebSocketGateway({
  namespace: 'market',
  cors: { origin: true, credentials: true },
})
export class MarketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MarketGateway.name);

  @WebSocketServer()
  server!: Server;

  // symbol -> 订阅该 symbol 的 client 数量
  private readonly symbolSubscribers = new Map<string, Set<string>>();

  constructor(private readonly marketService: MarketService) {}

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Market client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Market client disconnected: ${client.id}`);
    // 清理该 client 的所有订阅
    for (const [symbol, clients] of this.symbolSubscribers.entries()) {
      if (clients.delete(client.id) && clients.size === 0) {
        this.symbolSubscribers.delete(symbol);
        this.marketService.unsubscribe(symbol);
      }
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { symbol: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const symbol = data?.symbol;
    if (!symbol) return;

    if (!this.symbolSubscribers.has(symbol)) {
      this.symbolSubscribers.set(symbol, new Set());
      this.marketService.subscribe(symbol);
    }
    this.symbolSubscribers.get(symbol)!.add(client.id);
    this.logger.log(`Client ${client.id} subscribed ${symbol}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: { symbol: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const symbol = data?.symbol;
    if (!symbol) return;

    const clients = this.symbolSubscribers.get(symbol);
    if (clients) {
      clients.delete(client.id);
      if (clients.size === 0) {
        this.symbolSubscribers.delete(symbol);
        this.marketService.unsubscribe(symbol);
      }
    }
  }

  /**
   * 广播 Ticker 到订阅了该 symbol 的客户端
   */
  broadcastTicker(ticker: { symbol: string; lastPrice: number; bid: number; ask: number; timestamp: number }): void {
    this.server.emit('market:ticker', ticker);
  }
}
