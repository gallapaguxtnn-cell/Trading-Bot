import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValidationReport } from './validation-report.entity';
import { ValidationReportsService } from './validation-reports.service';
import { ValidationReportsController } from './validation-reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ValidationReport])],
  controllers: [ValidationReportsController],
  providers: [ValidationReportsService],
  exports: [ValidationReportsService],
})
export class ValidationReportsModule {}
