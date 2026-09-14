import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { BybitClientService } from './bybit-client.service';
import { ExchangeClientFactory } from './exchange-client.factory';

@Module({
  providers: [ExchangeService, BybitClientService, ExchangeClientFactory],
  exports: [ExchangeService, BybitClientService, ExchangeClientFactory]
})
export class ExchangeModule {}
