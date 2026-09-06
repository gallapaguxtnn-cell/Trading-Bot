import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { Portfolio } from './portfolio.entity';
import { Strategy } from '../strategies/strategy.entity';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [TypeOrmModule.forFeature([Portfolio, Strategy]), ExchangeModule],
  controllers: [PortfoliosController],
  providers: [PortfoliosService],
  exports: [PortfoliosService],
})
export class PortfoliosModule {}
