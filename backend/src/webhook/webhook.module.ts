import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { ExchangeModule } from '../exchange/exchange.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { TradesModule } from '../trades/trades.module';
import { BinanceWebSocketModule } from '../binance-ws/binance-ws.module';

@Module({
  imports: [ExchangeModule, StrategiesModule, TradesModule, BinanceWebSocketModule],
  controllers: [WebhookController],
  providers: [WebhookService]
})
export class WebhookModule {}
