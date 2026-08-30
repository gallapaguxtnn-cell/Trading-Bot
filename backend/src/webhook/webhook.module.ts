import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { SignalLog } from './signal-log.entity';
import { SignalLogService } from './signal-log.service';
import { SignalLogController } from './signal-log.controller';
import { ExchangeModule } from '../exchange/exchange.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { TradesModule } from '../trades/trades.module';
import { BinanceWebSocketModule } from '../binance-ws/binance-ws.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SignalLog]),
    ExchangeModule,
    StrategiesModule,
    TradesModule,
    BinanceWebSocketModule,
    CommonModule,
  ],
  controllers: [WebhookController, SignalLogController],
  providers: [WebhookService, SignalLogService],
  exports: [SignalLogService],
})
export class WebhookModule {}
