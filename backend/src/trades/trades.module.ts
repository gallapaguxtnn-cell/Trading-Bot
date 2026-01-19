import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from '../strategies/trade.entity';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { PositionSyncModule } from '../position-sync/position-sync.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade]),
    forwardRef(() => PositionSyncModule),
    StrategiesModule,
    ExchangeModule,
  ],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
