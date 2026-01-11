import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from '../strategies/trade.entity';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Trade])],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
