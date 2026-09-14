import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeModule } from '../exchange/exchange.module';
import { SymbolRulesService } from './symbol-rules.service';
import { CredentialsResolverService } from './credentials-resolver.service';
import { Portfolio } from '../portfolios/portfolio.entity';
import {
  ExchangeClientFactory,
  EXCHANGE_CLIENT_BYBIT,
  EXCHANGE_CLIENT_BINANCE,
} from '../exchange/exchange-client.factory';
import { BybitExchangeClient } from '../exchange/bybit-exchange.client';
import { BinanceClientService } from '../exchange/binance-client.service';

@Module({
  imports: [ExchangeModule, TypeOrmModule.forFeature([Portfolio])],
  providers: [
    SymbolRulesService,
    CredentialsResolverService,
    BybitExchangeClient,
    BinanceClientService,
    ExchangeClientFactory,
    { provide: EXCHANGE_CLIENT_BYBIT, useExisting: BybitExchangeClient },
    { provide: EXCHANGE_CLIENT_BINANCE, useExisting: BinanceClientService },
  ],
  exports: [
    SymbolRulesService,
    CredentialsResolverService,
    ExchangeClientFactory,
  ],
})
export class CommonModule {}
