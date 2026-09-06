import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { Strategy } from './strategy.entity';
import { Trade } from './trade.entity';
import { ExchangeModule } from '../exchange/exchange.module';
import { CommonModule } from '../common/common.module';
import { PortfoliosModule } from '../portfolios/portfolios.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Strategy, Trade]),
    ExchangeModule,
    CommonModule,
    PortfoliosModule
  ],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService]
})
export class StrategiesModule {}
