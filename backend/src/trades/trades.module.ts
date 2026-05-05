import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from './trade-execution.entity';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { PositionSyncModule } from '../position-sync/position-sync.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, TradeExecution]),
    forwardRef(() => PositionSyncModule),
    forwardRef(() => WebSocketModule),
    StrategiesModule,
    ExchangeModule,
  ],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
