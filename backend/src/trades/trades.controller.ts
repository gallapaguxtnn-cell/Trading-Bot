import { Controller, Get, Post, Query, Param, Logger } from '@nestjs/common';
import { TradesService } from './trades.service';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { StrategiesService } from '../strategies/strategies.service';
import { EncryptionUtil } from '../utils/encryption.util';
import { Exchange } from '../strategies/strategy.entity';
import { Trade } from '../strategies/trade.entity';
import { ExecutionType } from './trade-execution.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { toAccountContext } from '../common/account-context.util';
import { NeutralSide } from '../exchange/exchange-client.interface';
import { normalizeQuantity } from '../common/exchange-precision.util';

@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);

  constructor(
    private readonly tradesService: TradesService,
    private readonly positionSyncService: PositionSyncService,
    private readonly strategiesService: StrategiesService,
    private readonly exchangeFactory: ExchangeClientFactory,
    private readonly credentialsResolver: CredentialsResolverService,
  ) {}

  @Get()
  async findAll(@Query('status') status?: string, @Query('limit') limit?: string, @Query('portfolioId') portfolioId?: string) {
    try {
      return await this.tradesService.findAll(status, limit ? parseInt(limit) : undefined, portfolioId);
    } catch (error: any) {
      this.logger.error(`Failed to fetch trades: ${error.message}`);
      return [];
    }
  }

  @Get('stats')
  async getStats(@Query('portfolioId') portfolioId?: string) {
    try {
      return await this.tradesService.getStats(portfolioId);
    } catch (error: any) {
      this.logger.error(`Failed to fetch stats: ${error.message}`);
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

  @Get(':id/executions')
  async getTradeExecutions(@Param('id') id: string) {
    try {
      this.logger.log(`[EXECUTIONS] Fetching executions for trade ${id}`);

      const trade = await this.tradesService.findById(id);
      if (!trade) {
        this.logger.warn(`[EXECUTIONS] Trade ${id} not found`);
        return [];
      }

      let executions = await this.tradesService.findExecutions(id);

      if (executions.length === 0 && trade.status !== 'ERROR') {
        this.logger.warn(`[EXECUTIONS] No executions found for trade ${id}. Creating ENTRY execution from trade data.`);

        await this.tradesService.createExecution({
          tradeId: trade.id,
          type: ExecutionType.ENTRY,
          price: trade.entryPrice,
          quantity: trade.quantity,
          pnl: null,
          percentOfPosition: null,
          exchangeOrderId: trade.exchangeOrderId,
          executedAt: trade.timestamp
        });

        if (trade.status === 'CLOSED' && trade.exitPrice && trade.closedAt) {
          const closeType = this.getCloseExecutionType(trade.closeReason);

          await this.tradesService.createExecution({
            tradeId: trade.id,
            type: closeType,
            price: trade.exitPrice,
            quantity: trade.quantity,
            pnl: trade.pnl,
            percentOfPosition: 100,
            exchangeOrderId: null,
            executedAt: trade.closedAt
          });
        }

        executions = await this.tradesService.findExecutions(id);
        this.logger.log(`[EXECUTIONS] Created missing executions. Total: ${executions.length}`);
      }

      this.logger.log(`[EXECUTIONS] Returning ${executions.length} executions for trade ${id}`);
      return executions;
    } catch (error: any) {
      this.logger.error(`[EXECUTIONS] Failed to fetch executions for trade ${id}: ${error.message}`, error.stack);
      return [];
    }
  }

  private getCloseExecutionType(closeReason?: string): ExecutionType {
    if (!closeReason) return ExecutionType.MANUAL_CLOSE;

    switch (closeReason) {
      case 'TAKE_PROFIT_1':
        return ExecutionType.TAKE_PROFIT_1;
      case 'TAKE_PROFIT_2':
        return ExecutionType.TAKE_PROFIT_2;
      case 'TAKE_PROFIT_3':
        return ExecutionType.TAKE_PROFIT_3;
      case 'STOP_LOSS':
        return ExecutionType.STOP_LOSS;
      case 'SIGNAL':
        return ExecutionType.SIGNAL_CLOSE;
      default:
        return ExecutionType.MANUAL_CLOSE;
    }
  }

  @Post('sync')
  async forceSync() {
    const result = await this.positionSyncService.forceSync();
    return {
      success: true,
      message: 'Sync completed',
      ...result,
      lastSyncTime: this.positionSyncService.getLastSyncTime()
    };
  }

  @Get('sync/status')
  getSyncStatus() {
    return {
      lastSyncTime: this.positionSyncService.getLastSyncTime()
    };
  }

  @Post('close-all')
  async closeAllPositions(@Query('portfolioId') portfolioId?: string) {
    const openTrades = await this.tradesService.findOpenTrades(portfolioId);
    const results: { closed: number; errors: string[]; alreadyClosed: number } = {
      closed: 0,
      errors: [],
      alreadyClosed: 0
    };

    const strategiesMap = new Map();

    for (const trade of openTrades) {
      try {
        let strategy = strategiesMap.get(trade.strategyId);
        if (!strategy) {
          strategy = await this.strategiesService.findOne(trade.strategyId);
          if (strategy) {
            strategiesMap.set(trade.strategyId, strategy);
          }
        }

        if (!strategy) {
          await this.tradesService.updateTrade(trade.id, {
            status: 'CLOSED',
            closeReason: 'MANUAL',
            closedAt: new Date(),
            error: 'Strategy not found - marked as closed'
          });
          results.errors.push(`Strategy not found for trade ${trade.id} - marked as closed`);
          continue;
        }

        const credentials = await this.credentialsResolver.resolveCredentials(strategy);
        const resolvedStrategy = { ...strategy, ...credentials };
        const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
        const decryptedKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
        const decryptedSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();

        const closeResult = await this.closeTradeOnExchange(
          trade,
          resolvedStrategy,
          exchange,
          decryptedKey,
          decryptedSecret
        );

        if (closeResult.success) {
          results.closed++;
        } else if (closeResult.alreadyClosed) {
          results.alreadyClosed++;
        } else {
          results.errors.push(`Trade ${trade.id}: ${closeResult.error}`);
        }

      } catch (error: any) {
        this.logger.error(`Failed to close trade ${trade.id}: ${error.message}`);
        results.errors.push(`Trade ${trade.id}: ${error.message}`);
      }
    }

    return {
      success: true,
      message: `Closed ${results.closed} positions, ${results.alreadyClosed} already closed`,
      ...results
    };
  }

  @Post('close/:tradeId')
  async closePosition(@Param('tradeId') tradeId: string) {
    const trade = await this.tradesService.findOpenTrades()
      .then(trades => trades.find(t => t.id === tradeId));

    if (!trade) {
      return { success: false, message: 'Trade not found or already closed' };
    }

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) {
      await this.tradesService.updateTrade(trade.id, {
        status: 'CLOSED',
        closeReason: 'MANUAL',
        closedAt: new Date(),
        error: 'Strategy not found'
      });
      return { success: false, message: 'Strategy not found - trade marked as closed' };
    }

    const credentials = await this.credentialsResolver.resolveCredentials(strategy);
    const resolvedStrategy = { ...strategy, ...credentials };
    const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
    const decryptedKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
    const decryptedSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();

    const result = await this.closeTradeOnExchange(
      trade,
      resolvedStrategy,
      exchange,
      decryptedKey,
      decryptedSecret
    );

    if (result.success) {
      return { success: true, message: 'Position closed', pnl: result.pnl };
    } else if (result.alreadyClosed) {
      return { success: true, message: 'Position was already closed on exchange', pnl: result.pnl };
    } else {
      return { success: false, message: result.error };
    }
  }

  private async closeTradeOnExchange(
    trade: Trade,
    strategy: any,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string
  ): Promise<{ success: boolean; alreadyClosed?: boolean; pnl?: number; error?: string }> {

    try {
      this.logger.log(`[CLOSE] Starting to close trade ${trade.id} for ${trade.symbol} (hedgeMode: ${strategy.hedgeMode})`);

      const client = this.exchangeFactory.get(exchange);
      const ctx = toAccountContext(strategy, apiKey, apiSecret);
      const tradeSide = trade.side as NeutralSide;

      await client.cancelAllOrders(ctx, trade.symbol, strategy.hedgeMode ? tradeSide : undefined);

      const positionSize = await this.getPositionSize(exchange, client, ctx, trade.symbol, tradeSide);

      this.logger.log(`[CLOSE] Position size on exchange: ${positionSize}`);

      const exitPrice = await client.getCurrentPrice(ctx, trade.symbol);
      const entryPrice = parseFloat(trade.entryPrice as any);
      const dbQuantity = parseFloat(trade.quantity as any);

      if (positionSize === 0) {
        this.logger.warn(`[CLOSE] Position already closed on exchange for ${trade.symbol}`);

        let pnl = trade.pnl ? parseFloat(trade.pnl as any) : 0;

        await this.tradesService.updateTrade(trade.id, {
          status: 'CLOSED',
          exitPrice: exitPrice || entryPrice,
          pnl,
          closeReason: 'MANUAL',
          closedAt: new Date()
        });

        return { success: false, alreadyClosed: true, pnl };
      }

      const rules = await client.getSymbolRules(ctx, trade.symbol);
      const closeSide: NeutralSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const formattedQty = normalizeQuantity(positionSize, rules.qtyStep, rules.minQty);

      this.logger.log(`[CLOSE] Closing ${trade.symbol}: side=${closeSide}, qty=${formattedQty}`);

      await client.createOrder(ctx, {
        symbol: trade.symbol,
        side: closeSide,
        orderType: 'MARKET',
        qty: formattedQty,
        reduceOnly: true,
        hedgeMode: strategy.hedgeMode,
        positionSide: tradeSide,
      });

      let pnl: number;
      if (trade.side === 'BUY') {
        pnl = (exitPrice - entryPrice) * positionSize;
      } else {
        pnl = (entryPrice - exitPrice) * positionSize;
      }

      await this.tradesService.updateTrade(trade.id, {
        status: 'CLOSED',
        pnl,
        exitPrice,
        closeReason: 'MANUAL',
        closedAt: new Date()
      });

      await this.tradesService.createExecution({
        tradeId: trade.id,
        type: ExecutionType.MANUAL_CLOSE,
        price: exitPrice,
        quantity: positionSize,
        pnl: pnl,
        percentOfPosition: 100,
        exchangeOrderId: null
      });

      this.logger.log(`[CLOSE] Trade ${trade.id} closed successfully with P&L: ${pnl}`);

      return { success: true, pnl };

    } catch (error: any) {
      this.logger.error(`[CLOSE] Error closing trade ${trade.id}: ${error.message}`);

      if (error.response?.data) {
        this.logger.error(`[CLOSE] Exchange response: ${JSON.stringify(error.response.data)}`);
      }

      return { success: false, error: error.message };
    }
  }

  private async getPositionSize(
    exchange: Exchange,
    client: ReturnType<ExchangeClientFactory['get']>,
    ctx: ReturnType<typeof toAccountContext>,
    symbol: string,
    tradeSide: NeutralSide,
  ): Promise<number> {
    try {
      const positions = await client.getPositions(ctx, symbol);
      const position = exchange === Exchange.BYBIT
        ? positions.find((p) => p.symbol === symbol && parseFloat(p.size) > 0)
        : positions.find((p) => p.symbol === symbol && p.side === tradeSide);
      return position ? Math.abs(parseFloat(position.size)) : 0;
    } catch (error: any) {
      this.logger.error(`[CLOSE] Failed to get position size: ${error.message}`);
      return 0;
    }
  }

}
