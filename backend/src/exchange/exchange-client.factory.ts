import { Inject, Injectable, Optional } from '@nestjs/common';
import { Exchange } from '../strategies/strategy.entity';
import type { ExchangeClient } from './exchange-client.interface';

export const EXCHANGE_CLIENT_BYBIT = 'EXCHANGE_CLIENT_BYBIT';
export const EXCHANGE_CLIENT_BINANCE = 'EXCHANGE_CLIENT_BINANCE';
export const EXCHANGE_CLIENT_OKX = 'EXCHANGE_CLIENT_OKX';

@Injectable()
export class ExchangeClientFactory {
  private readonly clients = new Map<Exchange, ExchangeClient>();

  constructor(
    @Optional() @Inject(EXCHANGE_CLIENT_BYBIT) bybitClient?: ExchangeClient,
    @Optional() @Inject(EXCHANGE_CLIENT_BINANCE) binanceClient?: ExchangeClient,
    @Optional() @Inject(EXCHANGE_CLIENT_OKX) okxClient?: ExchangeClient,
  ) {
    if (bybitClient) this.clients.set(Exchange.BYBIT, bybitClient);
    if (binanceClient) this.clients.set(Exchange.BINANCE, binanceClient);
    if (okxClient) this.clients.set(Exchange.OKX, okxClient);
  }

  get(exchange: Exchange): ExchangeClient {
    const client = this.clients.get(exchange);
    if (!client) {
      throw new Error(`Nenhum ExchangeClient registrado para ${exchange}`);
    }
    return client;
  }

  has(exchange: Exchange): boolean {
    return this.clients.has(exchange);
  }

  assertSupported(exchange: Exchange): void {
    if (!this.clients.has(exchange)) {
      throw new Error(
        `Corretora ${exchange} nao possui ExchangeClient registrado. A ordem foi abortada para evitar execucao na corretora errada.`,
      );
    }
  }
}
