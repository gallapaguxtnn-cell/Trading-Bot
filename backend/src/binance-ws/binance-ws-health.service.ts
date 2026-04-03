import { Injectable, Logger } from '@nestjs/common';
import { WebSocketHealth } from './interfaces/binance-ws.interface';
import { UserDataStreamService } from './user-data-stream.service';
import { MarketDataStreamService } from './market-data-stream.service';

@Injectable()
export class BinanceWebSocketHealthService {
  private readonly logger = new Logger(BinanceWebSocketHealthService.name);
  private messageCount = 0;
  private lastResetTime = Date.now();

  constructor(
    private userDataStream: UserDataStreamService,
    private marketDataStream: MarketDataStreamService
  ) {}

  incrementMessageCount(): void {
    this.messageCount++;
  }

  getStatus(): WebSocketHealth {
    const userDataStreams = this.userDataStream.getAllConnections().map(conn => ({
      strategyId: conn.strategy.id,
      connected: conn.ws.readyState === 1,
      lastMessageAt: conn.lastMessageAt,
      reconnectAttempts: conn.reconnectAttempts,
    }));

    const marketDataStreams = this.marketDataStream.getAllConnections().map(conn => ({
      isTestnet: conn.isTestnet,
      connected: conn.ws.readyState === 1,
      symbols: Array.from(conn.symbols),
      lastMessageAt: conn.lastMessageAt,
    }));

    const messagesPerMinute = this.calculateMessagesPerMinute();

    return {
      userDataStreams,
      marketDataStreams,
      messagesPerMinute,
    };
  }

  private calculateMessagesPerMinute(): number {
    const now = Date.now();
    const elapsed = now - this.lastResetTime;

    if (elapsed >= 60000) {
      const rate = (this.messageCount / elapsed) * 60000;
      this.messageCount = 0;
      this.lastResetTime = now;
      return Math.round(rate);
    }

    return Math.round((this.messageCount / elapsed) * 60000);
  }
}
