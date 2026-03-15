import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from './trade-execution.entity';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradesRepository: Repository<Trade>,
    @InjectRepository(TradeExecution)
    private readonly executionsRepository: Repository<TradeExecution>,
  ) {}

  async create(trade: Partial<Trade>): Promise<any> {
    const savedTrade = await this.tradesRepository.save(trade);
    return this.normalizeTrade(savedTrade);
  }

  async findAll(status?: string, limit: number = 50): Promise<any[]> {
    const where: any = {};

    if (status && ['OPEN', 'CLOSED', 'ERROR'].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    const trades = await this.tradesRepository.find({
      where,
      order: { timestamp: 'DESC' },
      take: limit
    });

    return trades.map(this.normalizeTrade);
  }

  async findOpenTrades(): Promise<any[]> {
    const trades = await this.tradesRepository.find({
      where: { status: 'OPEN' },
      order: { timestamp: 'DESC' }
    });
    return trades.map(this.normalizeTrade);
  }

  async findOpenTradeBySymbolAndSide(
    strategyId: string,
    symbol: string,
    side: 'BUY' | 'SELL'
  ): Promise<any> {
    const trade = await this.tradesRepository.findOne({
      where: { strategyId, symbol, side, status: 'OPEN' }
    });
    return trade ? this.normalizeTrade(trade) : null;
  }

  async findRecentTradeBySymbol(
    strategyId: string,
    symbol: string,
    secondsAgo: number = 30
  ): Promise<any> {
    const cutoffTime = new Date(Date.now() - secondsAgo * 1000);

    const trade = await this.tradesRepository
      .createQueryBuilder('trade')
      .where('trade.strategyId = :strategyId', { strategyId })
      .andWhere('trade.symbol = :symbol', { symbol })
      .andWhere('trade.status = :status', { status: 'OPEN' })
      .andWhere('trade.timestamp > :cutoffTime', { cutoffTime })
      .orderBy('trade.timestamp', 'DESC')
      .getOne();

    return trade ? this.normalizeTrade(trade) : null;
  }

  async findLastTradeWithInitialQuantity(strategyId: string): Promise<any> {
    const trade = await this.tradesRepository
      .createQueryBuilder('trade')
      .where('trade.strategyId = :strategyId', { strategyId })
      .andWhere('trade.initialQuantity IS NOT NULL')
      .orderBy('trade.timestamp', 'DESC')
      .getOne();

    return trade ? this.normalizeTrade(trade) : null;
  }

  async findLastClosedTrade(strategyId: string): Promise<any> {
    const trade = await this.tradesRepository.findOne({
      where: { strategyId, status: 'CLOSED' },
      order: { timestamp: 'DESC' }
    });
    return trade ? this.normalizeTrade(trade) : null;
  }

  async countClosedTrades(strategyId: string): Promise<number> {
    return this.tradesRepository.count({
      where: { strategyId, status: 'CLOSED' }
    });
  }

  async findById(id: string): Promise<any> {
    const trade = await this.tradesRepository.findOneBy({ id });
    return trade ? this.normalizeTrade(trade) : null;
  }

  async updateTrade(id: string, updates: Partial<Trade>): Promise<any> {
    await this.tradesRepository.update(id, updates);
    const trade = await this.tradesRepository.findOneBy({ id });
    return trade ? this.normalizeTrade(trade) : null;
  }

  async getStats() {
    try {
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
        recentSignals: allTrades.map(this.normalizeTrade),
        openPositions: openTrades.map(this.normalizeTrade)
      };
    } catch (error) {
      return {
        totalPnL: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        activePositions: 0,
        winRate: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        recentSignals: [],
        openPositions: []
      };
    }
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
    if (price === null || price === undefined || price === '') {
      return 0;
    }
    const parsed = parseFloat(price);
    return isNaN(parsed) ? 0 : parsed;
  }

  private roundToTwo(value: number): number {
    if (!isFinite(value) || isNaN(value)) {
      return 0;
    }
    return Math.round(value * 100) / 100;
  }

  private roundToOne(value: number): number {
    if (!isFinite(value) || isNaN(value)) {
      return 0;
    }
    return Math.round(value * 10) / 10;
  }

  private normalizeTrade = (trade: Trade): any => {
    try {
      return {
        ...trade,
        pnl: trade.pnl ? this.parsePnL(trade.pnl) : null,
        entryPrice: this.parsePrice(trade.entryPrice),
        exitPrice: trade.exitPrice ? this.parsePrice(trade.exitPrice) : null,
        quantity: this.parsePrice(trade.quantity),
        binancePositionAmt: trade.binancePositionAmt ? this.parsePrice(trade.binancePositionAmt) : null,
        currentStopLoss: trade.currentStopLoss ? this.parsePrice(trade.currentStopLoss) : null,
        initialQuantity: trade.initialQuantity ? this.parsePrice(trade.initialQuantity) : null,
        timestamp: trade.timestamp,
        closedAt: trade.closedAt
      };
    } catch (error) {
      return {
        ...trade,
        pnl: 0,
        entryPrice: 0,
        exitPrice: null,
        quantity: 0,
        binancePositionAmt: null,
        currentStopLoss: null,
        initialQuantity: null,
        timestamp: new Date(),
        closedAt: null
      };
    }
  };

  async findExecutions(tradeId: string): Promise<any[]> {
    const executions = await this.executionsRepository.find({
      where: { tradeId },
      order: { executedAt: 'ASC' }
    });

    return executions.map(this.normalizeExecution);
  }

  private normalizeExecution = (execution: TradeExecution): any => {
    try {
      return {
        ...execution,
        price: this.parsePrice(execution.price),
        quantity: this.parsePrice(execution.quantity),
        pnl: execution.pnl ? this.parsePrice(execution.pnl) : 0,
        percentOfPosition: execution.percentOfPosition ? this.parsePrice(execution.percentOfPosition) : 0,
        executedAt: execution.executedAt
      };
    } catch (error) {
      return {
        ...execution,
        price: 0,
        quantity: 0,
        pnl: 0,
        percentOfPosition: 0,
        executedAt: new Date()
      };
    }
  };

  async createExecution(execution: Partial<TradeExecution>): Promise<any> {
    const savedExecution = await this.executionsRepository.save(execution);
    return this.normalizeExecution(savedExecution);
  }
}
