import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { TakeProfitService } from './take-profit.service';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { TradesModule } from '../trades/trades.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, TradeExecution]),
    ScheduleModule.forRoot(),
    StrategiesModule,
    ExchangeModule,
    forwardRef(() => TradesModule)
  ],
  providers: [TakeProfitService],
  exports: [TakeProfitService],
})
export class TakeProfitModule {}
