import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Exchange } from '../strategies/strategy.entity';

export enum PortfolioMode {
  DEMO = 'DEMO',
  REAL = 'REAL',
}

@Entity()
export class Portfolio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: Exchange, default: Exchange.BYBIT })
  exchange: Exchange;

  @Column({ type: 'enum', enum: PortfolioMode, default: PortfolioMode.DEMO })
  mode: PortfolioMode;

  @Column({ type: 'text', nullable: true, select: false })
  apiKey: string;

  @Column({ type: 'text', nullable: true, select: false })
  apiSecret: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
