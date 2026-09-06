import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeModule } from '../exchange/exchange.module';
import { SymbolRulesService } from './symbol-rules.service';
import { CredentialsResolverService } from './credentials-resolver.service';
import { Portfolio } from '../portfolios/portfolio.entity';

@Module({
  imports: [ExchangeModule, TypeOrmModule.forFeature([Portfolio])],
  providers: [SymbolRulesService, CredentialsResolverService],
  exports: [SymbolRulesService, CredentialsResolverService],
})
export class CommonModule {}
