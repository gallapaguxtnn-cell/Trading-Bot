import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ValidationReportsService } from './validation-reports.service';
import type { CreateValidationReportDto } from './validation-reports.service';

@Controller('validation-reports')
export class ValidationReportsController {
  constructor(private readonly service: ValidationReportsService) {}

  @Post()
  create(@Body() body: CreateValidationReportDto) {
    return this.service.create(body);
  }

  @Get()
  list(@Query('strategyId') strategyId?: string) {
    return this.service.findByStrategy(strategyId);
  }
}
