import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { StopLossService } from './stop-loss.service';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { TradesModule } from '../trades/trades.module';
import { BinanceWebSocketModule } from '../binance-ws/binance-ws.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, TradeExecution]),
    ScheduleModule.forRoot(),
    StrategiesModule,
    ExchangeModule,
    BinanceWebSocketModule,
    CommonModule,
    forwardRef(() => TradesModule)
  ],
  providers: [StopLossService],
  exports: [StopLossService],
})
export class StopLossModule {}
