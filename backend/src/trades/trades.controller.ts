import { Controller, Get } from '@nestjs/common';
import { TradesService } from './trades.service';

@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get()
  findAll() {
    return this.tradesService.findAll();
  }

  @Get('stats')
  getStats() {
    return this.tradesService.getStats();
  }
}
