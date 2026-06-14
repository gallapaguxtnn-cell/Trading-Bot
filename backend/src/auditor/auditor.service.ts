import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLog, AuditCategory, AuditSeverity } from './audit-log.entity';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { Strategy } from '../strategies/strategy.entity';
import { ExchangeService } from '../exchange/exchange.service';
import Decimal from 'decimal.js';

interface ExchangeOrder {
  orderId: string;
  price: number;
  avgPrice: number;
  executedQty: number;
  commission: number;
  commissionAsset: string;
  status: string;
  time: number;
}

interface ReconciliationResult {
  tradeId: string;
  issues: AuditLog[];
  exchangeData: ExchangeOrder | null;
  botData: {
    entryPrice: number;
    exitPrice: number | null;
    quantity: number;
    pnl: number | null;
  };
  calculatedPnl: number | null;
  feesFromExchange: number;
  feesFromBot: number;
  slippage: number | null;
  signalLatencyMs: number | null;
}

@Injectable()
export class AuditorService {
  private readonly logger = new Logger(AuditorService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @InjectRepository(TradeExecution)
    private execRepo: Repository<TradeExecution>,
    @InjectRepository(Strategy)
    private strategyRepo: Repository<Strategy>,
    private exchangeService: ExchangeService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runPeriodicAudit() {
    this.logger.log('Running periodic audit...');
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentTrades = await this.tradeRepo.find({
      where: { status: 'CLOSED', closedAt: Between(oneHourAgo, new Date()) },
    });

    for (const trade of recentTrades) {
      await this.reconcileTrade(trade.id);
    }
  }

  async reconcileTrade(tradeId: string): Promise<ReconciliationResult> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) throw new Error(`Trade ${tradeId} not found`);

    const strategy = await this.strategyRepo.findOne({ where: { id: trade.strategyId } });
    if (!strategy) throw new Error(`Strategy ${trade.strategyId} not found`);

    const executions = await this.execRepo.find({ where: { tradeId } });
    const issues: AuditLog[] = [];

    let exchangeOrder: ExchangeOrder | null = null;
    let feesFromExchange = 0;

    if (trade.exchangeOrderId) {
      try {
        exchangeOrder = await this.fetchExchangeOrder(
          strategy,
          trade.symbol,
          trade.exchangeOrderId,
        );
        if (exchangeOrder) {
          feesFromExchange = exchangeOrder.commission;
        }
      } catch (err) {
        this.logger.warn(`Could not fetch exchange order ${trade.exchangeOrderId}: ${err}`);
      }
    }

    if (exchangeOrder && trade.entryPrice) {
      const botEntry = new Decimal(trade.entryPrice);
      const exchEntry = new Decimal(exchangeOrder.avgPrice);
      const slippagePct = botEntry.minus(exchEntry).div(exchEntry).abs().times(100);
      const slippageVal = slippagePct.toNumber();

      if (slippagePct.gt(0.01)) {
        const log = this.createLog(trade, AuditCategory.PRICE_DEVIATION,
          slippageVal > 0.5 ? AuditSeverity.ERROR : AuditSeverity.WARNING,
          `Entry price deviation: bot=${botEntry.toFixed(8)} exchange=${exchEntry.toFixed(8)} (${slippagePct.toFixed(4)}%)`,
          { botPrice: trade.entryPrice, exchangePrice: exchangeOrder.avgPrice },
          exchangeOrder.avgPrice, Number(trade.entryPrice), slippageVal,
        );
        issues.push(log);
      }

      if (slippagePct.gt(0.05)) {
        const slippageLog = this.createLog(trade, AuditCategory.SLIPPAGE,
          slippageVal > 0.3 ? AuditSeverity.ERROR : AuditSeverity.WARNING,
          `Slippage detected: ${slippagePct.toFixed(4)}%`,
          { expectedPrice: trade.entryPrice, actualPrice: exchangeOrder.avgPrice },
          Number(trade.entryPrice), exchangeOrder.avgPrice, slippageVal,
        );
        issues.push(slippageLog);
      }
    }

    if (feesFromExchange > 0) {
      const log = this.createLog(trade, AuditCategory.FEE_MISMATCH,
        AuditSeverity.WARNING,
        `Bot P&L does not account for exchange fees: $${feesFromExchange.toFixed(4)}`,
        { exchangeFees: feesFromExchange, botPnl: trade.pnl },
        0, feesFromExchange, feesFromExchange,
      );
      issues.push(log);
    }

    let calculatedPnl: number | null = null;
    if (trade.status === 'CLOSED' && trade.exitPrice && trade.entryPrice) {
      const entry = new Decimal(trade.entryPrice);
      const exit = new Decimal(trade.exitPrice);
      const qty = new Decimal(trade.quantity);
      const direction = trade.side === 'BUY' ? 1 : -1;

      calculatedPnl = exit.minus(entry).times(qty).times(direction).toNumber();
      const adjustedPnl = calculatedPnl - feesFromExchange;

      if (trade.pnl !== null) {
        const botPnl = new Decimal(trade.pnl);
        const diff = botPnl.minus(adjustedPnl).abs();
        if (diff.gt(0.01)) {
          const log = this.createLog(trade, AuditCategory.PNL_MISMATCH,
            diff.gt(1) ? AuditSeverity.ERROR : AuditSeverity.WARNING,
            `P&L mismatch: bot=${botPnl.toFixed(4)} calculated=${new Decimal(adjustedPnl).toFixed(4)} diff=${diff.toFixed(4)}`,
            {
              botPnl: Number(trade.pnl),
              calculatedGross: calculatedPnl,
              calculatedNet: adjustedPnl,
              fees: feesFromExchange,
            },
            adjustedPnl, Number(trade.pnl), diff.toNumber(),
          );
          issues.push(log);
        }
      }
    }

    const entryExec = executions.find(e => e.type === 'ENTRY');
    let signalLatencyMs: number | null = null;
    if (entryExec && trade.timestamp) {
      signalLatencyMs = new Date(entryExec.executedAt).getTime() - new Date(trade.timestamp).getTime();
      if (signalLatencyMs > 5000) {
        const log = this.createLog(trade, AuditCategory.SIGNAL_LATENCY,
          signalLatencyMs > 30000 ? AuditSeverity.ERROR : AuditSeverity.WARNING,
          `Signal latency: ${signalLatencyMs}ms`,
          { webhookTime: trade.timestamp, executionTime: entryExec.executedAt },
          0, signalLatencyMs, signalLatencyMs,
        );
        issues.push(log);
      }
    }

    if (issues.length > 0) {
      await this.auditRepo.save(issues);
    }

    return {
      tradeId,
      issues,
      exchangeData: exchangeOrder,
      botData: {
        entryPrice: Number(trade.entryPrice),
        exitPrice: trade.exitPrice ? Number(trade.exitPrice) : null,
        quantity: Number(trade.quantity),
        pnl: trade.pnl ? Number(trade.pnl) : null,
      },
      calculatedPnl,
      feesFromExchange,
      feesFromBot: 0,
      slippage: exchangeOrder
        ? new Decimal(trade.entryPrice).minus(exchangeOrder.avgPrice).abs().div(exchangeOrder.avgPrice).times(100).toNumber()
        : null,
      signalLatencyMs,
    };
  }

  async reconcileStrategy(strategyId: string, from?: Date, to?: Date) {
    const where: Record<string, unknown> = { strategyId, status: 'CLOSED' };
    if (from && to) {
      where.closedAt = Between(from, to);
    }

    const trades = await this.tradeRepo.find({ where: where as any });
    const results: ReconciliationResult[] = [];

    for (const trade of trades) {
      const result = await this.reconcileTrade(trade.id);
      results.push(result);
    }

    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    const totalFeesExchange = results.reduce((sum, r) => sum + r.feesFromExchange, 0);
    const avgSlippage = results
      .filter(r => r.slippage !== null)
      .reduce((sum, r, _, arr) => sum + (r.slippage! / arr.length), 0);
    const avgLatency = results
      .filter(r => r.signalLatencyMs !== null)
      .reduce((sum, r, _, arr) => sum + (r.signalLatencyMs! / arr.length), 0);

    return {
      strategyId,
      tradesAudited: trades.length,
      totalIssues,
      totalFeesNotAccountedFor: totalFeesExchange,
      avgSlippagePct: avgSlippage,
      avgSignalLatencyMs: avgLatency,
      trades: results,
    };
  }

  async getAuditLogs(filters: {
    tradeId?: string;
    strategyId?: string;
    category?: AuditCategory;
    severity?: AuditSeverity;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    const qb = this.auditRepo.createQueryBuilder('log');

    if (filters.tradeId) qb.andWhere('log.tradeId = :tradeId', { tradeId: filters.tradeId });
    if (filters.strategyId) qb.andWhere('log.strategyId = :strategyId', { strategyId: filters.strategyId });
    if (filters.category) qb.andWhere('log.category = :category', { category: filters.category });
    if (filters.severity) qb.andWhere('log.severity = :severity', { severity: filters.severity });
    if (filters.from) qb.andWhere('log.createdAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('log.createdAt <= :to', { to: filters.to });

    qb.orderBy('log.createdAt', 'DESC');
    qb.take(filters.limit || 100);

    return qb.getMany();
  }

  async getAuditSummary(strategyId?: string) {
    const qb = this.auditRepo.createQueryBuilder('log');
    if (strategyId) qb.where('log.strategyId = :strategyId', { strategyId });

    const total = await qb.getCount();

    const bySeverity = await this.auditRepo
      .createQueryBuilder('log')
      .select('log.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where(strategyId ? 'log.strategyId = :strategyId' : '1=1', { strategyId })
      .groupBy('log.severity')
      .getRawMany();

    const byCategory = await this.auditRepo
      .createQueryBuilder('log')
      .select('log.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where(strategyId ? 'log.strategyId = :strategyId' : '1=1', { strategyId })
      .groupBy('log.category')
      .getRawMany();

    return { total, bySeverity, byCategory };
  }

  async compareBacktestVsBot(
    strategyId: string,
    backtestTrades: Array<{
      side: string;
      entry_price: number;
      exit_price: number;
      entry_time: string;
      exit_time: string;
      exit_reason: string;
      size_usd: number;
      leverage: number;
      fee_usd: number;
      pnl_usd: number;
    }>,
    from?: Date,
    to?: Date,
  ) {
    const where: Record<string, unknown> = { strategyId, status: 'CLOSED' };
    if (from && to) where.closedAt = Between(from, to);

    const botTrades = await this.tradeRepo.find({
      where: where as any,
      order: { timestamp: 'ASC' },
    });

    const matched: Array<{
      backtestTrade: (typeof backtestTrades)[0];
      botTrade: Trade | null;
      issues: string[];
    }> = [];

    const unmatched: Array<{ source: 'backtest' | 'bot'; trade: unknown }> = [];
    const usedBotIds = new Set<string>();

    for (const bt of backtestTrades) {
      const btEntry = new Date(bt.entry_time).getTime();
      const btSide = bt.side.toUpperCase();

      const match = botTrades.find(bot => {
        if (usedBotIds.has(bot.id)) return false;
        const botSide = bot.side === 'BUY' ? 'LONG' : 'SHORT';
        if (btSide !== botSide) return false;
        const botEntry = new Date(bot.timestamp).getTime();
        const timeDiff = Math.abs(btEntry - botEntry);
        return timeDiff < 300000;
      });

      if (match) {
        usedBotIds.add(match.id);
        const issues: string[] = [];

        const entryDev = Math.abs(bt.entry_price - Number(match.entryPrice)) / bt.entry_price * 100;
        if (entryDev > 0.05) {
          issues.push(`Entry price deviation: ${entryDev.toFixed(4)}% (backtest=${bt.entry_price} bot=${match.entryPrice})`);
        }

        if (bt.exit_price && match.exitPrice) {
          const exitDev = Math.abs(bt.exit_price - Number(match.exitPrice)) / bt.exit_price * 100;
          if (exitDev > 0.05) {
            issues.push(`Exit price deviation: ${exitDev.toFixed(4)}% (backtest=${bt.exit_price} bot=${match.exitPrice})`);
          }
        }

        if (match.pnl !== null) {
          const pnlDiff = Math.abs(bt.pnl_usd - Number(match.pnl));
          if (pnlDiff > 0.5) {
            issues.push(`P&L mismatch: backtest=${bt.pnl_usd.toFixed(4)} bot=${Number(match.pnl).toFixed(4)} diff=${pnlDiff.toFixed(4)}`);
          }
        }

        if (bt.fee_usd > 0 && match.pnl !== null) {
          issues.push(`Backtest accounted ${bt.fee_usd.toFixed(4)} in fees; bot P&L does not deduct fees`);
        }

        matched.push({ backtestTrade: bt, botTrade: match, issues });
      } else {
        unmatched.push({ source: 'backtest', trade: bt });
      }
    }

    for (const bot of botTrades) {
      if (!usedBotIds.has(bot.id)) {
        unmatched.push({ source: 'bot', trade: bot });
      }
    }

    const totalMatched = matched.length;
    const withIssues = matched.filter(m => m.issues.length > 0).length;
    const btPnl = backtestTrades.reduce((s, t) => s + t.pnl_usd, 0);
    const botPnl = botTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);

    return {
      strategyId,
      backtestTrades: backtestTrades.length,
      botTrades: botTrades.length,
      matched: totalMatched,
      unmatched: unmatched.length,
      tradesWithIssues: withIssues,
      backtestTotalPnl: btPnl,
      botTotalPnl: botPnl,
      pnlDifference: btPnl - botPnl,
      details: matched,
      unmatchedTrades: unmatched,
    };
  }

  private async fetchExchangeOrder(
    strategy: Strategy,
    symbol: string,
    orderId: string,
  ): Promise<ExchangeOrder | null> {
    try {
      const { EncryptionUtil } = await import('../utils/encryption.util');
      const apiKey = await EncryptionUtil.decrypt(strategy.apiKey);
      const apiSecret = await EncryptionUtil.decrypt(strategy.apiSecret);
      const isTestnet = !!strategy.isTestnet;
      const exchangeId = strategy.exchange as 'binance' | 'bybit';
      const exchange = await this.exchangeService.getExchange(exchangeId, apiKey, apiSecret, isTestnet);
      const order = await exchange.fetchOrder(orderId, symbol);
      return {
        orderId: String(order.id),
        price: order.price ?? 0,
        avgPrice: order.average ?? order.price ?? 0,
        executedQty: order.filled ?? 0,
        commission: order.fee?.cost ?? 0,
        commissionAsset: order.fee?.currency ?? 'USDT',
        status: order.status ?? 'unknown',
        time: order.timestamp ?? 0,
      };
    } catch {
      return null;
    }
  }

  private createLog(
    trade: Trade,
    category: AuditCategory,
    severity: AuditSeverity,
    message: string,
    details: Record<string, unknown>,
    expectedValue?: number,
    actualValue?: number,
    deviation?: number,
  ): AuditLog {
    const log = new AuditLog();
    log.tradeId = trade.id;
    log.strategyId = trade.strategyId;
    log.category = category;
    log.severity = severity;
    log.message = message;
    log.details = details;
    log.expectedValue = expectedValue ?? null;
    log.actualValue = actualValue ?? null;
    log.deviation = deviation ?? null;
    return log;
  }
}
