import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import WebSocket from 'ws';
import * as crypto from 'crypto';
import { ConnectionMetadata, ListenKeyResponse } from './interfaces/binance-ws.interface';
import { OrderUpdateEvent, AccountUpdateEvent } from './dto/binance-ws-events.dto';
import { BinanceRequestUtil } from '../utils/binance-request.util';

@Injectable()
export class UserDataStreamService {
  private readonly logger = new Logger(UserDataStreamService.name);
  private connections: Map<string, ConnectionMetadata> = new Map();
  private readonly RENEWAL_INTERVAL_MS = 25 * 60 * 1000;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(private eventEmitter: EventEmitter2) {}

  async connect(
    strategyId: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (this.connections.has(strategyId)) {
      this.logger.warn(`[UDS] Already connected: ${strategyId}`);
      return;
    }

    try {
      const listenKey = await this.getListenKey(apiKey, isTestnet);
      const wsUrl = this.getWebSocketUrl(listenKey, isTestnet);
      const ws = new WebSocket(wsUrl);

      this.setupWebSocketHandlers(ws, strategyId);

      const renewalInterval = setInterval(
        () => this.renewListenKey(strategyId),
        this.RENEWAL_INTERVAL_MS
      );

      this.connections.set(strategyId, {
        ws,
        listenKey,
        renewalInterval,
        strategy: { id: strategyId, apiKey, apiSecret, isTestnet },
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      });

      this.logger.log(`[UDS] Connected: ${strategyId}`);
    } catch (error) {
      this.logger.error(`[UDS] Connection failed: ${error.message}`);
      throw error;
    }
  }

  async disconnect(strategyId: string): Promise<void> {
    const conn = this.connections.get(strategyId);
    if (!conn) return;

    clearInterval(conn.renewalInterval);
    conn.ws.close();
    this.connections.delete(strategyId);

    try {
      await this.closeListenKey(conn.strategy.apiKey, conn.listenKey, conn.strategy.isTestnet);
    } catch (error) {
      this.logger.warn(`[UDS] Failed to close listen key: ${error.message}`);
    }

    this.logger.log(`[UDS] Disconnected: ${strategyId}`);
  }

  getConnectionMetadata(strategyId: string): ConnectionMetadata | undefined {
    return this.connections.get(strategyId);
  }

  getAllConnections(): ConnectionMetadata[] {
    return Array.from(this.connections.values());
  }

  private async getListenKey(apiKey: string, isTestnet: boolean): Promise<string> {
    const baseUrl = isTestnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    const response = await BinanceRequestUtil.post<ListenKeyResponse>(
      `${baseUrl}/fapi/v1/listenKey`,
      null,
      { headers: { 'X-MBX-APIKEY': apiKey } }
    );

    return response.data.listenKey;
  }

  private async renewListenKey(strategyId: string): Promise<void> {
    const conn = this.connections.get(strategyId);
    if (!conn) return;

    try {
      const baseUrl = conn.strategy.isTestnet
        ? 'https://testnet.binancefuture.com'
        : 'https://fapi.binance.com';

      await BinanceRequestUtil.put(
        `${baseUrl}/fapi/v1/listenKey`,
        null,
        { headers: { 'X-MBX-APIKEY': conn.strategy.apiKey } }
      );

      this.logger.log(`[UDS] Listen key renewed: ${strategyId}`);
    } catch (error) {
      this.logger.error(`[UDS] Renewal failed: ${error.message}`);
      await this.reconnect(strategyId);
    }
  }

  private async closeListenKey(apiKey: string, listenKey: string, isTestnet: boolean): Promise<void> {
    const baseUrl = isTestnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    await BinanceRequestUtil.delete(`${baseUrl}/fapi/v1/listenKey`, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
  }

  private getWebSocketUrl(listenKey: string, isTestnet: boolean): string {
    const baseUrl = isTestnet
      ? 'wss://stream.binancefuture.com'
      : 'wss://fstream.binance.com';
    return `${baseUrl}/ws/${listenKey}`;
  }

  private setupWebSocketHandlers(ws: WebSocket, strategyId: string): void {
    ws.on('open', () => {
      this.logger.log(`[UDS] WebSocket opened: ${strategyId}`);
      const conn = this.connections.get(strategyId);
      if (conn) {
        conn.reconnectAttempts = 0;
      }
    });

    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data, strategyId);
    });

    ws.on('error', (error) => {
      this.logger.error(`[UDS] WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
      this.logger.warn(`[UDS] WebSocket closed: ${strategyId}`);
      this.reconnect(strategyId);
    });

    ws.on('ping', () => {
      ws.pong();
    });
  }

  private handleMessage(data: WebSocket.Data, strategyId: string): void {
    try {
      const message = JSON.parse(data.toString());

      const conn = this.connections.get(strategyId);
      if (conn) {
        conn.lastMessageAt = Date.now();
      }

      if (message.e === 'ORDER_TRADE_UPDATE') {
        this.handleOrderUpdate(message);
      } else if (message.e === 'ACCOUNT_UPDATE') {
        this.handleAccountUpdate(message);
      } else if (message.e === 'listenKeyExpired') {
        this.logger.warn(`[UDS] Listen key expired: ${strategyId}`);
        this.reconnect(strategyId);
      }
    } catch (error) {
      this.logger.error(`[UDS] Message parse error: ${error.message}`);
    }
  }

  private handleOrderUpdate(message: any): void {
    const order = message.o;

    const event: OrderUpdateEvent = {
      symbol: order.s,
      orderId: order.i.toString(),
      clientOrderId: order.c,
      side: order.S,
      orderType: order.o,
      status: order.X,
      executedQty: parseFloat(order.z),
      avgPrice: parseFloat(order.ap),
      updateTime: message.T,
      positionSide: order.ps,
    };

    this.eventEmitter.emit('binance.order.update', event);
    this.logger.log(`[UDS] Order update: ${event.orderId} - ${event.status}`);
  }

  private handleAccountUpdate(message: any): void {
    const update = message.a;

    const event: AccountUpdateEvent = {
      updateTime: message.T,
      positions: update.P.map((p: any) => ({
        symbol: p.s,
        side: p.ps,
        positionAmount: parseFloat(p.pa),
        entryPrice: parseFloat(p.ep),
        unrealizedProfit: parseFloat(p.up),
        marginType: p.mt,
      })),
      balances: update.B.map((b: any) => ({
        asset: b.a,
        walletBalance: parseFloat(b.wb),
        crossWalletBalance: parseFloat(b.cw),
        balanceChange: parseFloat(b.bc),
      })),
    };

    this.eventEmitter.emit('binance.account.update', event);
  }

  private async reconnect(strategyId: string, attempt: number = 0): Promise<void> {
    const conn = this.connections.get(strategyId);
    if (!conn) return;

    if (attempt >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`[UDS] Max reconnect attempts reached: ${strategyId}`);
      this.connections.delete(strategyId);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
    await this.sleep(delay);

    this.logger.log(`[UDS] Reconnecting (attempt ${attempt + 1}): ${strategyId}`);

    try {
      await this.disconnect(strategyId);
      await this.connect(
        conn.strategy.id,
        conn.strategy.apiKey,
        conn.strategy.apiSecret,
        conn.strategy.isTestnet
      );
    } catch (error) {
      this.logger.error(`[UDS] Reconnect failed: ${error.message}`);
      await this.reconnect(strategyId, attempt + 1);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
