import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BinanceWebSocketService } from './binance-ws.service';
import { UserDataStreamService } from './user-data-stream.service';
import { MarketDataStreamService } from './market-data-stream.service';
import { BinanceWebSocketHealthService } from './binance-ws-health.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    BinanceWebSocketService,
    UserDataStreamService,
    MarketDataStreamService,
    BinanceWebSocketHealthService,
  ],
  exports: [BinanceWebSocketService],
})
export class BinanceWebSocketModule {}
