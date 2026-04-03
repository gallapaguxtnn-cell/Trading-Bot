import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { MarketDataConnection } from './interfaces/binance-ws.interface';
import { PriceUpdateEvent } from './dto/binance-ws-events.dto';

@Injectable()
export class MarketDataStreamService {
  private readonly logger = new Logger(MarketDataStreamService.name);
  private connections: Map<boolean, MarketDataConnection> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(private eventEmitter: EventEmitter2) {}

  async subscribe(symbol: string, isTestnet: boolean): Promise<void> {
    const normalizedSymbol = symbol.toLowerCase();
    let conn = this.connections.get(isTestnet);

    if (!conn) {
      conn = await this.createConnection(isTestnet);
      this.connections.set(isTestnet, conn);
    }

    const currentCount = conn.refCounts.get(normalizedSymbol) || 0;
    conn.refCounts.set(normalizedSymbol, currentCount + 1);

    if (currentCount === 0) {
      conn.symbols.add(normalizedSymbol);
      await this.updateSubscriptions(isTestnet);
      this.logger.log(`[MDS] Subscribed: ${normalizedSymbol}`);
    }
  }

  async unsubscribe(symbol: string, isTestnet: boolean): Promise<void> {
    const normalizedSymbol = symbol.toLowerCase();
    const conn = this.connections.get(isTestnet);
    if (!conn) return;

    const currentCount = conn.refCounts.get(normalizedSymbol) || 0;
    if (currentCount <= 1) {
      conn.refCounts.delete(normalizedSymbol);
      conn.symbols.delete(normalizedSymbol);
      await this.updateSubscriptions(isTestnet);
      this.logger.log(`[MDS] Unsubscribed: ${normalizedSymbol}`);
    } else {
      conn.refCounts.set(normalizedSymbol, currentCount - 1);
    }
  }

  getPrice(symbol: string): number | null {
    return null;
  }

  getAllConnections(): MarketDataConnection[] {
    return Array.from(this.connections.values());
  }

  private async createConnection(isTestnet: boolean): Promise<MarketDataConnection> {
    const baseUrl = isTestnet
      ? 'wss://stream.binancefuture.com'
      : 'wss://fstream.binance.com';

    const ws = new WebSocket(`${baseUrl}/stream`);

    const conn: MarketDataConnection = {
      ws,
      symbols: new Set(),
      refCounts: new Map(),
      lastMessageAt: Date.now(),
      isTestnet,
    };

    this.setupWebSocketHandlers(ws, isTestnet);

    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        this.logger.log(`[MDS] Connected: ${isTestnet ? 'testnet' : 'mainnet'}`);
        resolve(conn);
      });

      ws.on('error', (error) => {
        reject(error);
      });
    });
  }

  private setupWebSocketHandlers(ws: WebSocket, isTestnet: boolean): void {
    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data, isTestnet);
    });

    ws.on('error', (error) => {
      this.logger.error(`[MDS] WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
      this.logger.warn(`[MDS] WebSocket closed`);
      this.reconnect(isTestnet);
    });

    ws.on('ping', () => {
      ws.pong();
    });
  }

  private handleMessage(data: WebSocket.Data, isTestnet: boolean): void {
    try {
      const message = JSON.parse(data.toString());

      const conn = this.connections.get(isTestnet);
      if (conn) {
        conn.lastMessageAt = Date.now();
      }

      if (message.stream && message.data) {
        const streamName = message.stream;
        const tickerData = message.data;

        if (streamName.endsWith('@ticker')) {
          this.handleTickerUpdate(tickerData);
        }
      }
    } catch (error) {
      this.logger.error(`[MDS] Message parse error: ${error.message}`);
    }
  }

  private handleTickerUpdate(data: any): void {
    const event: PriceUpdateEvent = {
      symbol: data.s,
      price: parseFloat(data.c),
      timestamp: data.E,
    };

    this.eventEmitter.emit('binance.price.update', event);
  }

  private async updateSubscriptions(isTestnet: boolean): Promise<void> {
    const conn = this.connections.get(isTestnet);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;

    const streams = Array.from(conn.symbols).map(symbol => `${symbol}@ticker`);

    if (streams.length === 0) {
      return;
    }

    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    };

    conn.ws.send(JSON.stringify(subscribeMessage));
  }

  private async reconnect(isTestnet: boolean, attempt: number = 0): Promise<void> {
    const conn = this.connections.get(isTestnet);
    if (!conn) return;

    if (attempt >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`[MDS] Max reconnect attempts reached`);
      this.connections.delete(isTestnet);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
    await this.sleep(delay);

    this.logger.log(`[MDS] Reconnecting (attempt ${attempt + 1})`);

    try {
      const symbols = Array.from(conn.symbols);
      this.connections.delete(isTestnet);

      const newConn = await this.createConnection(isTestnet);
      this.connections.set(isTestnet, newConn);

      for (const symbol of symbols) {
        newConn.symbols.add(symbol);
        newConn.refCounts.set(symbol, conn.refCounts.get(symbol) || 1);
      }

      await this.updateSubscriptions(isTestnet);
    } catch (error) {
      this.logger.error(`[MDS] Reconnect failed: ${error.message}`);
      await this.reconnect(isTestnet, attempt + 1);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
