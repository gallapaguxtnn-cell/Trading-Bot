import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';

@Module({
  providers: [ExchangeService],
  exports: [ExchangeService]
})
export class ExchangeModule {}
