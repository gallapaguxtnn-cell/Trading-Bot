import { Controller, Get, Query } from '@nestjs/common';
import { SignalLogService } from './signal-log.service';

@Controller('signals')
export class SignalLogController {
  constructor(private readonly signalLogService: SignalLogService) {}

  @Get('range')
  async range(@Query('strategyId') strategyId?: string) {
    return this.signalLogService.range(strategyId);
  }

  @Get()
  async list(
    @Query('strategyId') strategyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.signalLogService.query({
      strategyId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
