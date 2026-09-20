import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AdminService } from './admin.service';

interface ResetTradesDto {
  dryRun?: boolean;
  confirm?: string;
  portfolioId?: string;
  executedBy?: string;
  cancelOrphanOrders?: boolean;
}

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('reset-trades')
  resetTrades(@Body() body: ResetTradesDto) {
    return this.adminService.resetTrades(body ?? {});
  }

  @Get('egress-ip')
  getEgressIp() {
    return this.adminService.getEgressIp();
  }

  @Post('reconcile-ghost-trades')
  reconcileGhostTrades(@Query('dryRun') dryRun?: string) {
    return this.adminService.reconcileGhostTrades(dryRun !== 'false');
  }
}
