import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from '../strategies/trade.entity';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradesRepository: Repository<Trade>,
  ) {}

  async create(trade: Partial<Trade>): Promise<Trade> {
    return this.tradesRepository.save(trade);
  }

  async findAll(): Promise<Trade[]> {
    return this.tradesRepository.find({
      order: { timestamp: 'DESC' },
      take: 50
    });
  }

  async getStats() {
    const [openTrades, closedTrades] = await Promise.all([
      this.tradesRepository.find({
        where: { status: 'OPEN' },
        order: { timestamp: 'DESC' }
      }),
      this.tradesRepository.find({
        where: { status: 'CLOSED' },
        order: { timestamp: 'DESC' }
      })
    ]);

    const realizedPnL = this.calculateTotalPnL(closedTrades);
    const unrealizedPnL = this.calculateTotalPnL(openTrades);
    const totalPnL = realizedPnL + unrealizedPnL;

    const wins = this.countWins(closedTrades);
    const losses = this.countLosses(closedTrades);
    const winRate = this.calculateWinRate(wins, closedTrades.length);

    const allTrades = [...openTrades, ...closedTrades]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);

    return {
      totalPnL: this.roundToTwo(totalPnL),
      realizedPnL: this.roundToTwo(realizedPnL),
      unrealizedPnL: this.roundToTwo(unrealizedPnL),
      activePositions: openTrades.length,
      winRate: this.roundToOne(winRate),
      totalTrades: closedTrades.length,
      wins,
      losses,
      recentSignals: allTrades.map(this.normalizeTrade)
    };
  }

  private calculateTotalPnL(trades: Trade[]): number {
    return trades.reduce((sum, t) => sum + this.parsePnL(t.pnl), 0);
  }

  private countWins(trades: Trade[]): number {
    return trades.filter(t => this.parsePnL(t.pnl) > 0).length;
  }

  private countLosses(trades: Trade[]): number {
    return trades.filter(t => this.parsePnL(t.pnl) < 0).length;
  }

  private calculateWinRate(wins: number, total: number): number {
    return total > 0 ? (wins / total) * 100 : 0;
  }

  private parsePnL(pnl: any): number {
    return parseFloat(pnl) || 0;
  }

  private parsePrice(price: any): number {
    return parseFloat(price) || 0;
  }

  private roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundToOne(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private normalizeTrade = (trade: Trade) => ({
    ...trade,
    pnl: trade.pnl ? this.parsePnL(trade.pnl) : null,
    entryPrice: this.parsePrice(trade.entryPrice),
    quantity: this.parsePrice(trade.quantity)
  });
}
