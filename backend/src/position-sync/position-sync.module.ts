import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PositionSyncService } from './position-sync.service';
import { Trade } from '../strategies/trade.entity';
import { Strategy } from '../strategies/strategy.entity';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { TradesModule } from '../trades/trades.module';
import { BinanceWebSocketModule } from '../binance-ws/binance-ws.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, Strategy]),
    ScheduleModule.forRoot(),
    StrategiesModule,
    ExchangeModule,
    BinanceWebSocketModule,
    CommonModule,
    forwardRef(() => TradesModule)
  ],
  providers: [PositionSyncService],
  exports: [PositionSyncService],
})
export class PositionSyncModule {}
