import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { BybitClientService } from './bybit-client.service';
import { ExchangeClientFactory, EXCHANGE_CLIENT_BYBIT } from './exchange-client.factory';
import { BybitExchangeClient } from './bybit-exchange.client';

@Module({
  providers: [
    ExchangeService,
    BybitClientService,
    BybitExchangeClient,
    ExchangeClientFactory,
    { provide: EXCHANGE_CLIENT_BYBIT, useExisting: BybitExchangeClient },
  ],
  exports: [ExchangeService, BybitClientService, ExchangeClientFactory]
})
export class ExchangeModule {}
