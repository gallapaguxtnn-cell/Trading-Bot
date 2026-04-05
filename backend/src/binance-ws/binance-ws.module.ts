import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BinanceWebSocketService } from './binance-ws.service';
import { UserDataStreamService } from './user-data-stream.service';
import { MarketDataStreamService } from './market-data-stream.service';
import { BinanceWebSocketHealthService } from './binance-ws-health.service';
import { BinanceWebSocketInitService } from './binance-ws-init.service';
import { Strategy } from '../strategies/strategy.entity';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([Strategy]),
  ],
  providers: [
    BinanceWebSocketService,
    UserDataStreamService,
    MarketDataStreamService,
    BinanceWebSocketHealthService,
    BinanceWebSocketInitService,
  ],
  exports: [BinanceWebSocketService],
})
export class BinanceWebSocketModule {}
