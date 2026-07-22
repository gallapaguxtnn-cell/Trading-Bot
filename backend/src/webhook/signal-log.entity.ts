import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type SignalDecision =
  | 'executed'
  | 'skipped_paused'
  | 'skipped_position_open'
  | 'skipped_single_mode'
  | 'skipped_new_orders_paused'
  | 'error';

@Entity('signal_log')
@Index(['strategyId', 'receivedAt'])
export class SignalLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  strategyId: string | null;

  @Column({ nullable: true })
  symbol: string | null;

  @Column({ nullable: true })
  action: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ default: 'error' })
  decision: string;

  @Column({ type: 'text', nullable: true })
  decisionReason: string | null;

  @Column({ nullable: true })
  tradeId: string | null;
}
