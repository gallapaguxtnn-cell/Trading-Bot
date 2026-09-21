import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { decideLimitSyncAction, shouldCancelPendingForStrategy } from '../webhook/buffer-expiry.util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { Trade } from '../strategies/trade.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { TradesService } from '../trades/trades.service';
import { ExecutionType } from '../trades/trade-execution.entity';
import { resolveManualCloseOutcome } from './manual-close.util';
import { findResidualTradeMatch, isDustByNotional } from './orphan-import.util';
import { EncryptionUtil } from '../utils/encryption.util';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { AccountUpdateEvent } from '../binance-ws/dto/binance-ws-events.dto';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { normalizeQuantity } from '../common/exchange-precision.util';
import { CredentialsResolverService, STRATEGY_CREDENTIAL_SELECT_COLUMNS } from '../common/credentials-resolver.service';
import type { ResolvedStrategy } from '../common/resolved-strategy.type';
import { toAccountContext } from '../common/account-context.util';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { AccountContext, ExchangeClient, NeutralSide, PositionInfo } from '../exchange/exchange-client.interface';

interface NormalizedPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
  markPrice: number;
}

function normalizePosition(p: PositionInfo): NormalizedPosition {
  return {
    symbol: p.symbol,
    side: p.side as 'BUY' | 'SELL',
    size: safeParseFloat(p.size),
    entryPrice: safeParseFloat(p.avgPrice),
    unrealizedPnl: safeParseFloat(p.unrealizedPnl),
    leverage: safeParseFloat(p.leverage, 1),
    markPrice: safeParseFloat(p.markPrice),
  };
}

function safeParseFloat(value: any, defaultValue: number = 0): number {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseFloat(value);

  if (!isFinite(parsed) || isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

@Injectable()
export class PositionSyncService implements OnModuleInit {
  private readonly logger = new Logger(PositionSyncService.name);
  private lastSyncTime: Date | null = null;
  private syncInProgress = false;
  private readonly fallbackEnabled: boolean;
  private readonly orphanMinNotionalUsdt: number;
  private readonly RESIDUAL_TRADE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

  /**
   * Format price with appropriate decimal places based on the price magnitude
   * This is a fallback when symbol rules aren't available
   */
  private formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toFixed(2);
    } else if (price >= 1) {
      return price.toFixed(4);
    } else if (price >= 0.01) {
      return price.toFixed(6);
    } else {
      return price.toFixed(8);
    }
  }

  constructor(
    @InjectRepository(Trade)
    private readonly tradesRepository: Repository<Trade>,
    @InjectRepository(Strategy)
    private readonly strategiesRepository: Repository<Strategy>,
    private readonly strategiesService: StrategiesService,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeFactory: ExchangeClientFactory,
    private readonly tradesService: TradesService,
    private readonly binanceWs: BinanceWebSocketService,
    private readonly eventEmitter: EventEmitter2,
    private readonly symbolRulesService: SymbolRulesService,
    private readonly credentialsResolver: CredentialsResolverService,
  ) {
    this.fallbackEnabled = process.env.BINANCE_WS_FALLBACK_ENABLED !== 'false';
    this.orphanMinNotionalUsdt = parseFloat(process.env.ORPHAN_MIN_NOTIONAL_USDT || '1') || 1;
  }

  onModuleInit() {
    if (this.binanceWs.isEnabled()) {
      this.logger.log('[WS] Position Sync WebSocket listeners registered');
    }
  }

  @OnEvent('binance.account.update')
  async handleAccountUpdate(event: AccountUpdateEvent) {
    this.logger.log(`[WS] Account update received with ${event.positions.length} positions`);
  }

  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  @Cron('*/5 * * * *')
  async syncPositions(): Promise<void> {
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      const activeStrategies = await this.strategiesRepository.find({
        where: { isActive: true },
        select: ['id', 'name', 'asset', ...STRATEGY_CREDENTIAL_SELECT_COLUMNS, 'portfolioId']
      });

      for (const strategy of activeStrategies) {
        try {
          const resolvedForRouting = await this.credentialsResolver.resolve(strategy);
          if (resolvedForRouting.exchange === Exchange.BINANCE) {
            const wsHealth = this.binanceWs.getHealth();
            const isConnected = wsHealth.userDataStreams.some(
              (stream: any) => stream.strategyId === strategy.id && stream.connected
            );

            if (isConnected) {
              this.logger.debug(`[WS] Skipping position sync for ${strategy.name} - WebSocket connected`);
              continue;
            }

            if (this.binanceWs.isEnabled()) {
              this.logger.warn(`[WS] WebSocket enabled but not connected for ${strategy.name} - skipping to avoid IP ban`);
              continue;
            }
          }

          await this.syncStrategyPositions(strategy);
        } catch (error) {
          this.logger.error(`Failed to sync strategy ${strategy.name}: ${error.message}`);
        }
      }

      try {
        await this.cancelPendingOrdersForInactiveStrategies();
      } catch (error: any) {
        this.logger.error(`Failed to cancel pending orders for inactive strategies: ${error.message}`);
      }

      try {
        await this.closeZombieTradesFromInactiveStrategies();
      } catch (error: any) {
        this.logger.error(`Failed to close zombie trades from inactive strategies: ${error.message}`);
      }

      this.lastSyncTime = new Date();
    } finally {
      this.syncInProgress = false;
    }
  }

  private async closeZombieTradesFromInactiveStrategies(): Promise<{ closed: number }> {
    const activeStrategyIds = new Set(
      (await this.strategiesRepository.find({ where: { isActive: true }, select: ['id'] })).map(s => s.id)
    );

    const openTrades = await this.tradesRepository.find({ where: { status: 'OPEN' } });
    const staleTrades = openTrades.filter(t => !activeStrategyIds.has(t.strategyId));
    if (staleTrades.length === 0) return { closed: 0 };

    const strategyIds = [...new Set(staleTrades.map(t => t.strategyId))];
    const strategies = await this.strategiesRepository.find({
      where: { id: In(strategyIds) },
      select: ['id', 'name', ...STRATEGY_CREDENTIAL_SELECT_COLUMNS, 'portfolioId'],
    });
    const strategyById = new Map(strategies.map(s => [s.id, s]));

    const groups = new Map<string, Trade[]>();
    for (const trade of staleTrades) {
      if (!strategyById.has(trade.strategyId)) continue;
      const key = trade.portfolioId || `strategy:${trade.strategyId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(trade);
    }

    const MIN_TRADE_AGE_SECONDS = 30;
    const now = Date.now();
    let closed = 0;

    for (const trades of groups.values()) {
      const representativeStrategy = strategyById.get(trades[0].strategyId)!;
      try {
        const credentials = await this.credentialsResolver.resolveCredentials(representativeStrategy);
        const resolvedStrategy = { ...representativeStrategy, ...credentials };
        if (!resolvedStrategy.apiKey || !resolvedStrategy.apiSecret) continue;

        const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
        const { apiKey, apiSecret } = await this.decryptCredentials(resolvedStrategy);
        const client = this.exchangeFactory.get(exchange);
        const ctx = toAccountContext(resolvedStrategy, apiKey, apiSecret);
        const openPositions = (await this.fetchPositions(client, ctx, exchange)).filter(p => p.size !== 0);

        for (const trade of trades) {
          const matchingPosition = openPositions.find(p => p.symbol === trade.symbol && p.side === trade.side);
          if (matchingPosition) continue;

          const tradeAgeSeconds = (now - new Date(trade.timestamp).getTime()) / 1000;
          if (tradeAgeSeconds < MIN_TRADE_AGE_SECONDS) continue;

          await this.closeTradeAsManual(trade, client, ctx);
          closed++;
          this.logger.warn(
            `[SYNC] [STALE STRATEGY CLEANUP] Closed zombie trade ${trade.id} (${trade.symbol} ${trade.side}) ` +
            `from inactive strategy ${trade.strategyId} - no longer exists on exchange`
          );
        }
      } catch (error: any) {
        this.logger.error(
          `[SYNC] [STALE STRATEGY CLEANUP] Failed to process trades for strategy ${representativeStrategy.id}: ${error.message}`
        );
      }
    }

    return { closed };
  }

  async forceSync(): Promise<{ synced: number; closed: number; imported: number; consolidated: number }> {
    let synced = 0;
    let closed = 0;
    let imported = 0;
    let consolidated = 0;

    const activeStrategies = await this.strategiesRepository.find({
      where: { isActive: true },
      select: ['id', 'name', 'asset', ...STRATEGY_CREDENTIAL_SELECT_COLUMNS, 'portfolioId']
    });

    for (const strategy of activeStrategies) {
      try {
        const result = await this.syncStrategyPositions(strategy);
        synced += result.synced;
        closed += result.closed;
        imported += result.imported;
        consolidated += result.consolidated;
      } catch (error) {
        this.logger.error(`Failed to sync strategy ${strategy.name}: ${error.message}`);
      }
    }

    this.lastSyncTime = new Date();
    return { synced, closed, imported, consolidated };
  }

  private accountScopeWhere(resolvedStrategy: { id: string; portfolioId?: string | null }): { portfolioId: string } | { strategyId: string } {
    if (resolvedStrategy.portfolioId) {
      return { portfolioId: resolvedStrategy.portfolioId };
    }
    return { strategyId: resolvedStrategy.id };
  }

  private async syncStrategyPositions(strategy: Strategy): Promise<{ synced: number; closed: number; imported: number; consolidated: number }> {
    const credentials = await this.credentialsResolver.resolveCredentials(strategy);
    const resolvedStrategy = { ...strategy, ...credentials };
    if (!resolvedStrategy.apiKey || !resolvedStrategy.apiSecret) {
      return { synced: 0, closed: 0, imported: 0, consolidated: 0 };
    }

    const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
    const { apiKey, apiSecret } = await this.decryptCredentials(resolvedStrategy);
    const client = this.exchangeFactory.get(exchange);
    const ctx = toAccountContext(resolvedStrategy, apiKey, apiSecret);

    const positions = await this.fetchPositions(client, ctx, exchange);
    const openPositions = positions.filter(p => p.size !== 0);

    let synced = 0;
    let closed = 0;
    let imported = 0;
    let consolidated = 0;

    for (const position of openPositions) {
      const existingTrades = await this.tradesRepository.find({
        where: {
          ...this.accountScopeWhere(resolvedStrategy),
          symbol: position.symbol,
          side: position.side,
          status: 'OPEN'
        },
        order: { timestamp: 'ASC' }
      });

      if (existingTrades.length === 0) {
        if (exchange === Exchange.BYBIT) {
          const rules = await client.getSymbolRules(ctx, position.symbol);
          const minQty = parseFloat(rules.minQty);

          if (position.size < minQty) {
            this.logger.warn(
              `[SYNC] Orphan position detected but quantity ${position.size} < minQty ${minQty}. ` +
              `This is dust from closed position. Ignoring.`
            );
            continue;
          }
        }

        if (isDustByNotional(position.size, position.markPrice, this.orphanMinNotionalUsdt)) {
          this.logger.warn(
            `[SYNC] Orphan position detected but notional ${(position.size * position.markPrice).toFixed(4)} USDT ` +
            `< ${this.orphanMinNotionalUsdt} USDT. This is dust from closed position. Ignoring.`
          );
          continue;
        }

        const recentlyClosed = await this.tradesRepository.find({
          where: {
            ...this.accountScopeWhere(resolvedStrategy),
            symbol: position.symbol,
            side: position.side,
            status: 'CLOSED',
            closedAt: MoreThan(new Date(Date.now() - this.RESIDUAL_TRADE_LOOKBACK_MS)),
          },
          order: { closedAt: 'DESC' },
        });

        const residualMatch = findResidualTradeMatch(
          recentlyClosed.map(t => ({ id: t.id, entryPrice: parseFloat(t.entryPrice as any) })),
          position.entryPrice,
        );

        if (residualMatch) {
          const tradeToReopen = recentlyClosed.find(t => t.id === residualMatch.id)!;
          await this.reopenResidualTrade(tradeToReopen, position);
          this.logger.warn('[SYNC] Resíduo de trade recém-fechado — reaberto em vez de importar duplicata');
          synced++;
          continue;
        }

        this.logger.warn(`[SYNC] Orphan position detected: ${position.symbol} (${position.side}) - importing...`);
        await this.importOrphanPosition(resolvedStrategy, position);
        imported++;
      } else if (existingTrades.length === 1) {
        if (existingTrades[0].strategyId === resolvedStrategy.id && (resolvedStrategy.breakAgain || resolvedStrategy.moveSLToBreakeven)) {
             await this.checkBreakAgain(existingTrades[0], position, resolvedStrategy, apiKey, apiSecret, resolvedStrategy.siteId);
        }

        await this.updateTradeFromPosition(existingTrades[0], position);
        synced++;
      } else {
        if (existingTrades[0].strategyId === resolvedStrategy.id && (resolvedStrategy.breakAgain || resolvedStrategy.moveSLToBreakeven)) {
          await this.checkBreakAgain(existingTrades[0], position, resolvedStrategy, apiKey, apiSecret, resolvedStrategy.siteId);
        }

        await this.consolidateTrades(existingTrades, position, client, ctx);
        consolidated += existingTrades.length - 1;
        synced++;
        this.logger.log(`[SYNC] Consolidated ${existingTrades.length} trades into 1 for ${position.symbol}`);
      }
    }

    for (const position of openPositions) {
      const duplicateCheck = await this.tradesRepository.find({
        where: {
          ...this.accountScopeWhere(resolvedStrategy),
          symbol: position.symbol,
          side: position.side,
          status: 'OPEN'
        },
        order: { timestamp: 'ASC' }
      });

      if (duplicateCheck.length > 1) {
        this.logger.warn(`[SYNC] Found ${duplicateCheck.length} duplicate trades for ${position.symbol} (${position.side}), consolidating...`);
        await this.consolidateTrades(duplicateCheck, position, client, ctx);
        consolidated += duplicateCheck.length - 1;
        this.logger.log(`[SYNC] Consolidated ${duplicateCheck.length} trades into 1 for ${position.symbol}`);
      }
    }

    const allLocalOpenTrades = await this.tradesRepository.find({
      where: { strategyId: resolvedStrategy.id, status: 'OPEN' }
    });

    const MIN_TRADE_AGE_SECONDS = 30;
    const now = Date.now();

    for (const trade of allLocalOpenTrades) {
      const matchingPosition = openPositions.find(p =>
        p.symbol === trade.symbol && p.side === trade.side
      );

      if (!matchingPosition) {
        // Race condition protection: Don't close trades that were created recently
        const tradeAgeMs = now - new Date(trade.timestamp).getTime();
        const tradeAgeSeconds = tradeAgeMs / 1000;

        if (tradeAgeSeconds < MIN_TRADE_AGE_SECONDS) {
          continue;
        }

        if (trade.type === 'LIMIT' && trade.exchangeOrderId) {
          const orderStatus = await this.checkOrderStatus(
            trade.exchangeOrderId,
            trade.symbol,
            client,
            ctx,
          );

          const hasProtection = !!trade.stopLossOrderId && !!trade.takeProfitOrderId;
          const action = decideLimitSyncAction({ orderStatus, hasProtection });

          if (action === 'keep') {
            this.logger.debug(`[SYNC] Trade ${trade.id} has pending LIMIT order (${orderStatus}), keeping open`);
            continue;
          }

          if (action === 'protect') {
            this.logger.log(`[SYNC] Trade ${trade.id} filled without protection, requesting protection creation`);
            this.eventEmitter.emit('limit.protection.resume', { tradeId: trade.id });
            continue;
          }

          if (orderStatus === 'FILLED' || orderStatus === 'Filled') {
            this.logger.log(`[SYNC] Trade ${trade.id} order FILLED but no position - position was closed externally`);
          }
        }

        await this.closeTradeAsManual(trade, client, ctx);
        closed++;
        this.logger.log(`[SYNC] Closed trade ${trade.id} for ${trade.symbol} - no longer exists on exchange`);
      }
    }

    return { synced, closed, imported, consolidated };
  }

  async getPositionSize(
    exchange: Exchange,
    symbol: string,
    side: 'BUY' | 'SELL',
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    siteId?: string | null
  ): Promise<number | null> {
    try {
      const client = this.exchangeFactory.get(exchange);
      const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: isTestnet ? 'DEMO' : 'REAL', region: (siteId as any) ?? null };
      const positions = (await this.fetchPositions(client, ctx, exchange));
      const position = positions.find(p => p.symbol === symbol && p.side === side);
      return position ? position.size : 0;
    } catch (error: any) {
      this.logger.warn(`[SYNC] Failed to fetch position size for ${symbol}: ${error.message}`);
      return null;
    }
  }

  private async fetchPositions(client: ExchangeClient, ctx: AccountContext, exchange: Exchange): Promise<NormalizedPosition[]> {
    try {
      const positions = await client.getPositions(ctx);
      return positions.map(normalizePosition);
    } catch (error: any) {
      const statusCode = error.response?.status;
      if (statusCode === 401) {
        this.logger.error(
          `[${exchange.toUpperCase()} AUTH ERROR] API Key is invalid or expired. ` +
          `Please update your ${exchange} API credentials. Status: 401 Unauthorized`
        );
        throw new Error(`${exchange} API Key invalid or expired. Please update credentials.`);
      } else if (statusCode === 403) {
        this.logger.error(
          `[${exchange.toUpperCase()} AUTH ERROR] API Key lacks required permissions or IP is not whitelisted. ` +
          `Please check your ${exchange} API settings. Status: 403 Forbidden`
        );
        throw new Error(`${exchange} API Key lacks permissions. Check API settings and IP whitelist.`);
      }
      this.logger.error(`Failed to fetch ${exchange} positions: ${error.message}`);
      throw error;
    }
  }

  private async cancelPendingOrdersForInactiveStrategies(): Promise<void> {
    const pendingLimitTrades = await this.tradesRepository.find({
      where: { status: 'OPEN', type: 'LIMIT' },
    });
    if (!pendingLimitTrades.length) return;

    const strategyCache = new Map<string, Strategy | null>();
    for (const trade of pendingLimitTrades) {
      if (!trade.exchangeOrderId) continue;

      let strategy: Strategy | null;
      if (strategyCache.has(trade.strategyId)) {
        strategy = strategyCache.get(trade.strategyId) as Strategy | null;
      } else {
        strategy = await this.strategiesRepository.findOne({
          where: { id: trade.strategyId },
          select: ['id', 'name', ...STRATEGY_CREDENTIAL_SELECT_COLUMNS, 'isActive', 'pauseNewOrders', 'portfolioId'],
        });
        strategyCache.set(trade.strategyId, strategy);
      }

      if (!strategy) continue;
      if (!shouldCancelPendingForStrategy(strategy)) continue;
      const credentials = await this.credentialsResolver.resolveCredentials(strategy);
      const resolvedStrategy = { ...strategy, ...credentials };
      if (!resolvedStrategy.apiKey || !resolvedStrategy.apiSecret) continue;

      try {
        const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
        const { apiKey, apiSecret } = await this.decryptCredentials(resolvedStrategy);
        const client = this.exchangeFactory.get(exchange);
        const ctx = toAccountContext(resolvedStrategy, apiKey, apiSecret);
        const orderStatus = await this.checkOrderStatus(trade.exchangeOrderId, trade.symbol, client, ctx);
        const s = (orderStatus || '').toLowerCase();
        const isPending = s === 'new' || s === 'partiallyfilled' || s === 'partially_filled';
        if (!isPending) continue;

        await client.cancelOrder(ctx, trade.symbol, trade.exchangeOrderId);
        trade.status = 'ERROR';
        trade.error = 'Ordem cancelada: estratégia pausada/desativada';
        trade.closeReason = 'SIGNAL';
        await this.tradesRepository.save(trade);
        this.eventEmitter.emit('signal.mark', { tradeId: trade.id, decision: 'cancelled_strategy_paused', reason: trade.error });
        this.logger.log(`[SYNC] Cancelled pending LIMIT order ${trade.exchangeOrderId} for trade ${trade.id} - strategy paused/disabled`);
      } catch (error: any) {
        this.logger.warn(`[SYNC] Failed to cancel pending order for paused strategy (trade ${trade.id}): ${error.message}`);
      }
    }
  }

  private async checkOrderStatus(
    orderId: string,
    symbol: string,
    client: ExchangeClient,
    ctx: AccountContext,
  ): Promise<string | null> {
    try {
      let orderInfo = await client.getOrderInfo(ctx, symbol, orderId);

      if (!orderInfo) {
        orderInfo = await client.getOrderHistory(ctx, symbol, orderId);
      }

      return orderInfo?.orderStatus || null;
    } catch (error) {
      this.logger.error(`Failed to check order status for ${orderId}: ${error.message}`);
      return null;
    }
  }

  private async consolidateTrades(
    trades: Trade[],
    position: NormalizedPosition,
    client?: ExchangeClient,
    ctx?: AccountContext,
  ): Promise<Trade> {
    trades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const primaryTrade = trades[0];
    const duplicateTrades = trades.slice(1);

    primaryTrade.quantity = position.size as any;
    primaryTrade.entryPrice = position.entryPrice as any;
    primaryTrade.pnl = position.unrealizedPnl as any;
    primaryTrade.binancePositionAmt = position.size as any;

    await this.tradesRepository.save(primaryTrade);

    for (const trade of duplicateTrades) {
      if (client && ctx) {
        await this.cancelOpenOrders(trade, client, ctx);
      }

      // Mark as closed - these weren't actually closed separately
      // The P&L is tracked on the primary trade, not the duplicates
      trade.status = 'CLOSED';
      trade.closeReason = 'MANUAL'; // Use MANUAL as it's the closest available reason
      trade.closedAt = new Date();
      trade.binancePositionAmt = 0 as any;
      // Don't set fake exitPrice/pnl - leave them as-is or null to indicate consolidation
      // This preserves data integrity and prevents misleading P&L calculations
      trade.exitPrice = null as any;
      trade.pnl = null as any;
      trade.stopLossOrderId = null;
      trade.takeProfitOrderId = null;
      trade.error = 'Duplicate trade consolidated into primary trade';
      trade.excludeFromStats = true;
      await this.tradesRepository.save(trade);

      this.logger.debug(`[CONSOLIDATE] Consolidated duplicate trade ${trade.id} into ${primaryTrade.id} for ${trade.symbol}`);
    }

    this.logger.log(
      `[CONSOLIDATE] ${primaryTrade.symbol} | Qty: ${position.size} | Entry: ${position.entryPrice} | P&L: ${position.unrealizedPnl.toFixed(4)}`
    );

    return primaryTrade;
  }

  private async closeTradeAsManual(
    trade: Trade,
    client: ExchangeClient,
    ctx: AccountContext,
  ): Promise<void> {
    await this.cancelOpenOrders(trade, client, ctx);

    const exitPrice = await client.getLastTradePrice(ctx, trade.symbol);
    const currentPrice = exitPrice || await client.getCurrentPrice(ctx, trade.symbol);

    const entryPrice = parseFloat(trade.entryPrice as any);
    const quantity = parseFloat(trade.quantity as any);

    let segmentPnl: number;
    if (trade.side === 'BUY') {
      segmentPnl = (currentPrice - entryPrice) * quantity;
    } else {
      segmentPnl = (entryPrice - currentPrice) * quantity;
    }

    const priorExecutions = await this.tradesService.findExecutions(trade.id);
    const { totalPnl, closeReason } = resolveManualCloseOutcome(priorExecutions, segmentPnl);

    if (quantity > 0) {
      try {
        await this.tradesService.createExecution({
          tradeId: trade.id,
          type: ExecutionType.MANUAL_CLOSE,
          price: currentPrice,
          quantity,
          pnl: segmentPnl,
          percentOfPosition: 100,
        });
      } catch (e: any) {
        this.logger.warn(`[SYNC] Falha ao gravar execucao de fechamento (trade ${trade.id}): ${e.message}`);
      }
    }

    trade.status = 'CLOSED';
    trade.exitPrice = currentPrice as any;
    trade.pnl = totalPnl as any;
    trade.closeReason = closeReason;
    trade.closedAt = new Date();
    trade.binancePositionAmt = 0 as any;
    trade.stopLossOrderId = null;
    trade.takeProfitOrderId = null;

    await this.tradesRepository.save(trade);
  }

  private async cancelOpenOrders(
    trade: Trade,
    client: ExchangeClient,
    ctx: AccountContext,
  ): Promise<void> {
    if (trade.stopLossOrderId) {
      if (trade.stopLossOrderId.startsWith('BYBIT_TRADING_STOP')) {
        try {
          const side = (trade.side === 'BUY' ? 'BUY' : 'SELL') as NeutralSide;
          const strategy = await this.strategiesRepository.findOne({ where: { id: trade.strategyId } });
          await client.clearTradingStop(ctx, trade.symbol, side, strategy?.hedgeMode);
          this.logger.log(`[CANCEL] Cleared trading stop for ${trade.symbol}`);
        } catch (error: any) {
          this.logger.warn(`[CANCEL] Failed to clear trading stop: ${error.message}`);
        }
      } else {
        try {
          await client.cancelOrder(ctx, trade.symbol, trade.stopLossOrderId);
          this.logger.log(`[CANCEL] Cancelled SL order ${trade.stopLossOrderId}`);
        } catch (error: any) {
          this.logger.warn(`[CANCEL] Failed to cancel SL: ${error.message}`);
        }
      }
    }

    if (trade.takeProfitOrderId) {
      if (trade.takeProfitOrderId.includes('|')) {
        const tpEntries = trade.takeProfitOrderId.split('|');
        for (const entry of tpEntries) {
          const orderId = entry.includes(':') ? entry.split(':')[1] : entry;
          if (!orderId || orderId === 'null' || orderId === 'undefined') continue;

          try {
            await client.cancelOrder(ctx, trade.symbol, orderId);
            this.logger.log(`[CANCEL] Cancelled TP order ${orderId}`);
          } catch (error: any) {
            this.logger.warn(`[CANCEL] Failed to cancel TP ${orderId}: ${error.message}`);
          }
        }
      } else if (!trade.takeProfitOrderId.startsWith('BYBIT_TRADING_STOP')) {
        try {
          await client.cancelOrder(ctx, trade.symbol, trade.takeProfitOrderId);
          this.logger.log(`[CANCEL] Cancelled TP order ${trade.takeProfitOrderId}`);
        } catch (error: any) {
          this.logger.warn(`[CANCEL] Failed to cancel TP: ${error.message}`);
        }
      }
    }
  }

  private async updateTradeFromPosition(trade: Trade, position: NormalizedPosition): Promise<void> {
    if (trade.side !== position.side) {
      this.logger.error(
        `[SYNC INCONSISTENCY] Trade ${trade.id} is ${trade.side} but exchange position is ${position.side} for ${trade.symbol}. ` +
        `This may indicate a sync issue. Correcting trade side to match exchange.`
      );
      trade.side = position.side;
    }

    if (!(trade.lastTpLevel || 0)) {
      trade.pnl = position.unrealizedPnl as any;
    }
    trade.binancePositionAmt = position.size as any;
    trade.quantity = position.size as any;
    trade.entryPrice = position.entryPrice as any;

    await this.tradesRepository.save(trade);
  }

  private async decryptCredentials(strategy: ResolvedStrategy) {
    const [apiKey, apiSecret] = await Promise.all([
      EncryptionUtil.decrypt(strategy.apiKey),
      EncryptionUtil.decrypt(strategy.apiSecret)
    ]);

    return {
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim()
    };
  }

  private async importOrphanPosition(strategy: Strategy, position: NormalizedPosition): Promise<Trade> {
    const trade = this.tradesRepository.create({
      strategyId: strategy.id,
      portfolioId: (strategy as any).portfolioId ?? null,
      symbol: position.symbol,
      side: position.side,
      type: 'MARKET',
      entryPrice: position.entryPrice as any,
      quantity: position.size as any,
      pnl: position.unrealizedPnl as any,
      status: 'OPEN',
      binancePositionAmt: position.size as any,
      origin: 'IMPORTED',
    });

    const savedTrade = await this.tradesRepository.save(trade);
    this.logger.log(`[SYNC] Imported orphan position as trade ${savedTrade.id}: ${position.symbol} ${position.side} @ ${position.entryPrice}`);
    return savedTrade;
  }

  private async reopenResidualTrade(trade: Trade, position: NormalizedPosition): Promise<Trade> {
    trade.status = 'OPEN';
    trade.quantity = position.size as any;
    trade.binancePositionAmt = position.size as any;
    trade.exitPrice = null;
    trade.closeReason = null;
    trade.closedAt = null;
    return this.tradesRepository.save(trade);
  }

  public async checkBreakAgain(
    trade: Trade,
    position: NormalizedPosition | undefined,
    strategy: ResolvedStrategy,
    apiKey: string,
    apiSecret: string,
    siteId?: string | null
  ): Promise<void> {
    try {
        const entryPrice = safeParseFloat(trade.entryPrice as any);
        const currentStopLoss = safeParseFloat(trade.currentStopLoss as any);
        const side = trade.side;
        const lastTpLevel = trade.lastTpLevel || 0;

        if (!entryPrice || !currentStopLoss) {
          this.logger.debug(`[BREAK] Skipping: entryPrice=${entryPrice}, currentStopLoss=${currentStopLoss}`);
          return;
        }

        let newStopLoss: number | null = null;
        let triggeredLevel = '';

        const tp1Percent = strategy.takeProfitPercentage1 || 0;
        const tp2Percent = strategy.takeProfitPercentage2 || 0;
        const tp3Percent = strategy.takeProfitPercentage3 || 0;

        const getPriceAtPercent = (percent: number) => {
            if (side === 'BUY') return entryPrice * (1 + percent / 100);
            return entryPrice * (1 - percent / 100);
        };

        const tp1Price = tp1Percent ? getPriceAtPercent(tp1Percent) : null;
        const tp2Price = tp2Percent ? getPriceAtPercent(tp2Percent) : null;
        const tp3Price = tp3Percent ? getPriceAtPercent(tp3Percent) : null;

        if (side === 'BUY') {
            if (strategy.moveSLToBreakeven && lastTpLevel >= 2 && currentStopLoss < entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP2+ filled -> SL to Breakeven';
                this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
            else if (strategy.moveSLToBreakeven && lastTpLevel >= 1 && currentStopLoss < entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP1 filled -> SL to Breakeven';
                this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 3 && tp2Price && currentStopLoss < tp2Price) {
                newStopLoss = tp2Price;
                triggeredLevel = 'TP3 filled -> SL to TP2';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp2Price.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 2 && tp1Price && currentStopLoss < tp1Price) {
                newStopLoss = tp1Price;
                triggeredLevel = 'TP2 filled -> SL to TP1';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp1Price.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 1 && currentStopLoss < entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP1 filled -> SL to Entry';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
        } else {
            if (strategy.moveSLToBreakeven && lastTpLevel >= 2 && currentStopLoss > entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP2+ filled -> SL to Breakeven';
                this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
            else if (strategy.moveSLToBreakeven && lastTpLevel >= 1 && currentStopLoss > entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP1 filled -> SL to Breakeven';
                this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 3 && tp2Price && currentStopLoss > tp2Price) {
                newStopLoss = tp2Price;
                triggeredLevel = 'TP3 filled -> SL to TP2';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp2Price.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 2 && tp1Price && currentStopLoss > tp1Price) {
                newStopLoss = tp1Price;
                triggeredLevel = 'TP2 filled -> SL to TP1';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp1Price.toFixed(4)}`);
            }
            else if (strategy.breakAgain && lastTpLevel >= 1 && currentStopLoss > entryPrice) {
                newStopLoss = entryPrice;
                triggeredLevel = 'TP1 filled -> SL to Entry';
                this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
            }
        }

        if (newStopLoss) {
            const currentSlFormatted = currentStopLoss ? currentStopLoss.toFixed(4) : 'N/A';
            this.logger.log(
              `[BREAK] ${triggeredLevel} | ` +
              `Trade ID: ${trade.id.substring(0, 8)} | Symbol: ${trade.symbol} | ` +
              `Qty: ${safeParseFloat(trade.quantity as any).toFixed(2)} | ` +
              `Old SL: ${currentSlFormatted} → New SL: ${newStopLoss.toFixed(4)} | ` +
              `Note: Other trades in same position keep their own independent SL`
            );

            const formattedStopLoss = this.formatPrice(newStopLoss);
            const client = this.exchangeFactory.get(strategy.exchange);
            const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: strategy.isTestnet ? 'DEMO' : 'REAL', region: (siteId as any) ?? null };
            const neutralSide = (side === 'BUY' ? 'BUY' : 'SELL') as NeutralSide;

            if (strategy.exchange === Exchange.BYBIT && !trade.isFromAveraging) {
                 await client.setTradingStop(ctx, trade.symbol, neutralSide, formattedStopLoss, undefined, strategy.hedgeMode);
                 this.logger.log(
                   `[BYBIT] Updated position-level SL via setTradingStop to ${formattedStopLoss} (first entry only)`
                 );
            } else if (strategy.exchange === Exchange.BYBIT && trade.isFromAveraging) {
                 this.logger.log(
                   `[BYBIT] Averaging trade: Updated currentStopLoss to ${formattedStopLoss} in DB (software monitoring). ` +
                   `Note: Cannot use setTradingStop for averaging trades (only 1 position-level SL allowed).`
                 );
            } else {
                     try {
                        if (trade.stopLossOrderId) {
                             await client.cancelOrder(ctx, trade.symbol, trade.stopLossOrderId);
                        }

                        const tradeQuantity = Math.abs(safeParseFloat(trade.quantity as any));
                        const rules = await client.getSymbolRules(ctx, trade.symbol);
                        const normalizedQty = normalizeQuantity(tradeQuantity, rules.qtyStep, rules.minQty);

                        if (normalizedQty === '0') {
                          throw new Error(
                            `Normalized quantity for ${trade.symbol} rounded to 0 (raw=${tradeQuantity}, step=${rules.qtyStep}, minQty=${rules.minQty}). Aborting SL update.`
                          );
                        }

                        const newSlOrder = await client.createStopLossOrder(ctx, trade.symbol, neutralSide, normalizedQty, formattedStopLoss, strategy.hedgeMode);

                        trade.stopLossOrderId = newSlOrder.orderId;
                     } catch(err) {
                         this.logger.error(`[BREAK AGAIN] Failed to update SL on Binance: ${err.message}`);
                     }
            }
            
            trade.currentStopLoss = newStopLoss as any;
            await this.tradesRepository.save(trade);
        }

    } catch (err) {
        this.logger.error(`[BREAK AGAIN] Error in check logic: ${err.message}`);
    }
  }
}
