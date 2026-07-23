import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('validation_report')
export class ValidationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  strategyId: string | null;

  @Column({ type: 'jsonb' })
  report: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  configHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  engineVersion: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
