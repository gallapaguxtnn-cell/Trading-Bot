import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity()
export class Trade {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  strategyId: string;

  @Column()
  symbol: string;

  @Column()
  side: 'BUY' | 'SELL';

  @Column()
  type: 'MARKET' | 'LIMIT';

  @Column("decimal", { precision: 18, scale: 8 })
  entryPrice: number;

  @Column("decimal", { precision: 18, scale: 8 })
  quantity: number;

  @Column("decimal", { precision: 18, scale: 8, nullable: true })
  pnl: number; // Null if open

  @Column({ default: 'OPEN' })
  status: 'OPEN' | 'CLOSED' | 'SIMULATED' | 'ERROR';

  @Column({ type: 'text', nullable: true })
  exchangeOrderId: string;

  @Column({ nullable: true })
  error: string;

  @CreateDateColumn()
  timestamp: Date;
}
