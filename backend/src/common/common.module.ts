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
  EXCHANGE_CLIENT_OKX,
} from '../exchange/exchange-client.factory';
import { BybitExchangeClient } from '../exchange/bybit-exchange.client';
import { BinanceClientService } from '../exchange/binance-client.service';
import { OkxClientService } from '../exchange/okx-client.service';

@Module({
  imports: [ExchangeModule, TypeOrmModule.forFeature([Portfolio])],
  providers: [
    SymbolRulesService,
    CredentialsResolverService,
    BybitExchangeClient,
    BinanceClientService,
    OkxClientService,
    ExchangeClientFactory,
    { provide: EXCHANGE_CLIENT_BYBIT, useExisting: BybitExchangeClient },
    { provide: EXCHANGE_CLIENT_BINANCE, useExisting: BinanceClientService },
    { provide: EXCHANGE_CLIENT_OKX, useExisting: OkxClientService },
  ],
  exports: [
    SymbolRulesService,
    CredentialsResolverService,
    ExchangeClientFactory,
  ],
})
export class CommonModule {}
