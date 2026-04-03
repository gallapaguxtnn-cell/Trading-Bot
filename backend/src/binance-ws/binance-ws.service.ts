import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserDataStreamService } from './user-data-stream.service';
import { MarketDataStreamService } from './market-data-stream.service';
import { BinanceWebSocketHealthService } from './binance-ws-health.service';
import { OrderUpdateEvent, AccountUpdateEvent, PriceUpdateEvent } from './dto/binance-ws-events.dto';
import { WebSocketHealth } from './interfaces/binance-ws.interface';

@Injectable()
export class BinanceWebSocketService implements OnModuleDestroy {
  private readonly logger = new Logger(BinanceWebSocketService.name);
  private readonly enabled: boolean;
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();

  constructor(
    private userDataStream: UserDataStreamService,
    private marketDataStream: MarketDataStreamService,
    private healthService: BinanceWebSocketHealthService
  ) {
    this.enabled = process.env.BINANCE_WS_ENABLED === 'true';

    if (this.enabled) {
      this.logger.log('[WS] Binance WebSocket service enabled');
    } else {
      this.logger.warn('[WS] Binance WebSocket service disabled');
    }
  }

  async onModuleDestroy() {
    this.logger.log('[WS] Shutting down WebSocket connections');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async subscribeUserDataStream(
    strategyId: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (!this.enabled) return;

    await this.userDataStream.connect(strategyId, apiKey, apiSecret, isTestnet);
  }

  async unsubscribeUserDataStream(strategyId: string): Promise<void> {
    if (!this.enabled) return;

    await this.userDataStream.disconnect(strategyId);
  }

  async subscribeMarketData(symbol: string, isTestnet: boolean): Promise<void> {
    if (!this.enabled) return;

    await this.marketDataStream.subscribe(symbol, isTestnet);
  }

  async unsubscribeMarketData(symbol: string, isTestnet: boolean): Promise<void> {
    if (!this.enabled) return;

    await this.marketDataStream.unsubscribe(symbol, isTestnet);
  }

  getCachedPrice(symbol: string): number | null {
    const cached = this.priceCache.get(symbol);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > 5000) {
      this.priceCache.delete(symbol);
      return null;
    }

    return cached.price;
  }

  getHealth(): WebSocketHealth {
    return this.healthService.getStatus();
  }

  @OnEvent('binance.order.update')
  private handleOrderUpdate(event: OrderUpdateEvent): void {
    this.healthService.incrementMessageCount();
  }

  @OnEvent('binance.account.update')
  private handleAccountUpdate(event: AccountUpdateEvent): void {
    this.healthService.incrementMessageCount();
  }

  @OnEvent('binance.price.update')
  private handlePriceUpdate(event: PriceUpdateEvent): void {
    this.priceCache.set(event.symbol, {
      price: event.price,
      timestamp: event.timestamp,
    });
    this.healthService.incrementMessageCount();
  }
}
