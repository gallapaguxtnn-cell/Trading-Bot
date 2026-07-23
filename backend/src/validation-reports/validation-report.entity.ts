import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('validation_report')
export class ValidationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  strategyId: string | null;

  @Column({ type: 'jsonb' })
  report: Record<string, unknown>;

  @Column({ nullable: true })
  configHash: string | null;

  @Column({ nullable: true })
  engineVersion: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
