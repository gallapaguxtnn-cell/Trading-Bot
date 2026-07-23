import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidationReport } from './validation-report.entity';

export interface CreateValidationReportDto {
  strategyId?: string;
  report: Record<string, unknown>;
  configHash?: string;
  engineVersion?: string;
}

@Injectable()
export class ValidationReportsService {
  constructor(
    @InjectRepository(ValidationReport)
    private readonly repo: Repository<ValidationReport>,
  ) {}

  create(dto: CreateValidationReportDto): Promise<ValidationReport> {
    const entity = this.repo.create({
      strategyId: dto.strategyId ?? null,
      report: dto.report ?? {},
      configHash: dto.configHash ?? null,
      engineVersion: dto.engineVersion ?? null,
    });
    return this.repo.save(entity);
  }

  findByStrategy(strategyId?: string): Promise<ValidationReport[]> {
    const where = strategyId ? { strategyId } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }
}
