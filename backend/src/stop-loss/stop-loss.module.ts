import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { StopLossService } from './stop-loss.service';
import { Trade } from '../strategies/trade.entity';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade]),
    ScheduleModule.forRoot(),
    StrategiesModule,
    ExchangeModule
  ],
  providers: [StopLossService],
  exports: [StopLossService],
})
export class StopLossModule {}
