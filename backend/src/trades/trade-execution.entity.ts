import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
import { Trade } from './trade.entity';

export enum ExecutionType {
  ENTRY = 'ENTRY',
  TAKE_PROFIT_1 = 'TAKE_PROFIT_1',
  TAKE_PROFIT_2 = 'TAKE_PROFIT_2',
  TAKE_PROFIT_3 = 'TAKE_PROFIT_3',
  STOP_LOSS = 'STOP_LOSS',
  MANUAL_CLOSE = 'MANUAL_CLOSE',
  SIGNAL_CLOSE = 'SIGNAL_CLOSE'
}

@Entity('trade_execution')
export class TradeExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Trade, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tradeId' })
  trade: Trade;

  @Column()
  tradeId: string;

  @Column({
    type: 'enum',
    enum: ExecutionType
  })
  type: ExecutionType;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  price: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  quantity: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  pnl: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  percentOfPosition: number;

  @CreateDateColumn()
  executedAt: Date;

  @Column({ type: 'text', nullable: true })
  exchangeOrderId: string;
}
