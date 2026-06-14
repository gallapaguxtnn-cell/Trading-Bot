import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { AuditorService } from './auditor.service';
import { AuditCategory, AuditSeverity } from './audit-log.entity';

interface BacktestTradeDto {
  side: string;
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  exit_reason: string;
  size_usd: number;
  leverage: number;
  fee_usd: number;
  pnl_usd: number;
}

interface CompareBacktestDto {
  strategyId: string;
  backtestTrades: BacktestTradeDto[];
  from?: string;
  to?: string;
}

@Controller('api/auditor')
export class AuditorController {
  constructor(private readonly auditorService: AuditorService) {}

  @Post('reconcile/trade/:tradeId')
  async reconcileTrade(@Param('tradeId') tradeId: string) {
    return this.auditorService.reconcileTrade(tradeId);
  }

  @Post('reconcile/strategy/:strategyId')
  async reconcileStrategy(
    @Param('strategyId') strategyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditorService.reconcileStrategy(
      strategyId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Post('compare-backtest')
  async compareBacktest(@Body() body: CompareBacktestDto) {
    return this.auditorService.compareBacktestVsBot(
      body.strategyId,
      body.backtestTrades,
      body.from ? new Date(body.from) : undefined,
      body.to ? new Date(body.to) : undefined,
    );
  }

  @Get('logs')
  async getLogs(
    @Query('tradeId') tradeId?: string,
    @Query('strategyId') strategyId?: string,
    @Query('category') category?: AuditCategory,
    @Query('severity') severity?: AuditSeverity,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditorService.getAuditLogs({
      tradeId,
      strategyId,
      category,
      severity,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('summary')
  async getSummary(@Query('strategyId') strategyId?: string) {
    return this.auditorService.getAuditSummary(strategyId);
  }
}
