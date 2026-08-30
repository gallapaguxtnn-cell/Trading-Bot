import { Module } from '@nestjs/common';
import { ExchangeModule } from '../exchange/exchange.module';
import { SymbolRulesService } from './symbol-rules.service';

@Module({
  imports: [ExchangeModule],
  providers: [SymbolRulesService],
  exports: [SymbolRulesService],
})
export class CommonModule {}
