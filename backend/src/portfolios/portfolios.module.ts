import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { PortfolioMigrationService } from './portfolio-migration.service';
import { Portfolio } from './portfolio.entity';
import { Strategy } from '../strategies/strategy.entity';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [TypeOrmModule.forFeature([Portfolio, Strategy]), ExchangeModule],
  controllers: [PortfoliosController],
  providers: [PortfoliosService, PortfolioMigrationService],
  exports: [PortfoliosService, PortfolioMigrationService],
})
export class PortfoliosModule {}
