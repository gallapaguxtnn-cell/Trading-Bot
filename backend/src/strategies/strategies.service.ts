import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy, Exchange } from './strategy.entity';
import { Trade } from './trade.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { PortfoliosService } from '../portfolios/portfolios.service';
import { PortfolioSummary } from '../portfolios/portfolio-public.interface';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { toAccountContext } from '../common/account-context.util';

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(
    @InjectRepository(Strategy)
    private strategiesRepository: Repository<Strategy>,
    @InjectRepository(Trade)
    private tradesRepository: Repository<Trade>,
    private readonly exchangeFactory: ExchangeClientFactory,
    private readonly credentialsResolver: CredentialsResolverService,
    private readonly portfoliosService: PortfoliosService,
  ) {}

  private async attachPortfolioSummaries<T extends Strategy>(
    strategies: T[],
  ): Promise<Array<T & { portfolio: PortfolioSummary | null }>> {
    const portfolioIds = [...new Set(strategies.map((s) => s.portfolioId).filter((id): id is string => !!id))];
    const summaries = await this.portfoliosService.findSummariesByIds(portfolioIds);
    return strategies.map((s) => ({ ...s, portfolio: s.portfolioId ? summaries.get(s.portfolioId) ?? null : null }));
  }

  async findAll(): Promise<Array<Strategy & { portfolio: PortfolioSummary | null }>> {
    const strategies = await this.strategiesRepository.find();
    return this.attachPortfolioSummaries(strategies);
  }

  findAllWithCredentials(): Promise<Strategy[]> {
    return this.strategiesRepository
      .createQueryBuilder('strategy')
      .addSelect(['strategy.apiKey', 'strategy.apiSecret'])
      .getMany();
  }

  findOne(id: string): Promise<Strategy | null> {
    return this.strategiesRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'asset',
        'exchange',
        'direction',
        'isActive',
        'isTestnet',
        'isRealAccount',
        'leverage',
        'marginMode',
        'defaultQuantity',
        'stopLossPercentage',
        'takeProfitPercentage1',
        'takeProfitPercentage2',
        'takeProfitPercentage3',
        'takeProfitQuantity1',
        'takeProfitQuantity2',
        'takeProfitQuantity3',
        'enableTakeProfit1',
        'enableTakeProfit2',
        'enableTakeProfit3',
        'breakAgain',
        'moveSLToBreakeven',
        'bufferEntry',
        'bufferPercentage',
        'timeframe',
        'bufferExpiryCandles',
        'useAccountPercentage',
        'accountPercentage',
        'enableCompound',
        'tradingMode',
        'allowAveraging',
        'hedgeMode',
        'pauseNewOrders',
        'apiKey',
        'apiSecret',
        'portfolioId'
      ]
    });
  }

  async findOnePublic(id: string): Promise<(Strategy & { portfolio: PortfolioSummary | null }) | null> {
    const strategy = await this.strategiesRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'asset',
        'exchange',
        'direction',
        'isActive',
        'isTestnet',
        'isRealAccount',
        'leverage',
        'marginMode',
        'defaultQuantity',
        'stopLossPercentage',
        'takeProfitPercentage1',
        'takeProfitPercentage2',
        'takeProfitPercentage3',
        'takeProfitQuantity1',
        'takeProfitQuantity2',
        'takeProfitQuantity3',
        'enableTakeProfit1',
        'enableTakeProfit2',
        'enableTakeProfit3',
        'breakAgain',
        'moveSLToBreakeven',
        'bufferEntry',
        'bufferPercentage',
        'timeframe',
        'bufferExpiryCandles',
        'useAccountPercentage',
        'accountPercentage',
        'enableCompound',
        'tradingMode',
        'allowAveraging',
        'hedgeMode',
        'pauseNewOrders',
        'portfolioId'
      ]
    });
    if (!strategy) return null;
    const [withPortfolio] = await this.attachPortfolioSummaries([strategy]);
    return withPortfolio;
  }

  async create(strategy: Partial<Strategy>): Promise<Strategy> {
    this.logger.log(
      `[STRATEGY CREATE] Risk values received:\n` +
      `  SL%: ${strategy.stopLossPercentage} (type: ${typeof strategy.stopLossPercentage})\n` +
      `  TP1%: ${strategy.takeProfitPercentage1} (type: ${typeof strategy.takeProfitPercentage1})\n` +
      `  TP2%: ${strategy.takeProfitPercentage2} (type: ${typeof strategy.takeProfitPercentage2})\n` +
      `  TP3%: ${strategy.takeProfitPercentage3} (type: ${typeof strategy.takeProfitPercentage3})`
    );
    if (strategy.apiKey) {
        strategy.apiKey = await EncryptionUtil.encrypt(strategy.apiKey);
    }
    if (strategy.apiSecret) {
        strategy.apiSecret = await EncryptionUtil.encrypt(strategy.apiSecret);
    }
    const newStrategy = this.strategiesRepository.create(strategy);
    return this.strategiesRepository.save(newStrategy);
  }

  async update(id: string, strategy: Partial<Strategy>): Promise<Strategy | null> {
    this.logger.log(
      `[STRATEGY UPDATE] Risk values received:\n` +
      `  SL%: ${strategy.stopLossPercentage} (type: ${typeof strategy.stopLossPercentage})\n` +
      `  TP1%: ${strategy.takeProfitPercentage1} (type: ${typeof strategy.takeProfitPercentage1})\n` +
      `  TP2%: ${strategy.takeProfitPercentage2} (type: ${typeof strategy.takeProfitPercentage2})\n` +
      `  TP3%: ${strategy.takeProfitPercentage3} (type: ${typeof strategy.takeProfitPercentage3})`
    );
    if (strategy.apiKey) {
        strategy.apiKey = await EncryptionUtil.encrypt(strategy.apiKey);
    }
    if (strategy.apiSecret) {
        strategy.apiSecret = await EncryptionUtil.encrypt(strategy.apiSecret);
    }
    await this.strategiesRepository.update(id, strategy);
    return this.strategiesRepository.findOneBy({ id });
  }

  async remove(id: string): Promise<void> {
    await this.cancelPendingLimitOrders(id);
    await this.strategiesRepository.delete(id);
  }

  private async cancelPendingLimitOrders(id: string): Promise<void> {
    try {
      const strategy = await this.findOne(id);
      if (!strategy) return;
      const credentials = await this.credentialsResolver.resolveCredentials(strategy);
      const resolvedStrategy = { ...strategy, ...credentials };
      if (!resolvedStrategy.apiKey || !resolvedStrategy.apiSecret) return;

      const pendingTrades = await this.tradesRepository.find({
        where: { strategyId: id, status: 'OPEN', type: 'LIMIT' },
      });
      if (!pendingTrades.length) return;

      const apiKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
      const apiSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();
      const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
      const client = this.exchangeFactory.get(exchange);
      const ctx = toAccountContext(resolvedStrategy, apiKey, apiSecret);

      for (const trade of pendingTrades) {
        if (!trade.exchangeOrderId) continue;
        try {
          await client.cancelOrder(ctx, trade.symbol, trade.exchangeOrderId);
          await this.tradesRepository.update(trade.id, {
            status: 'ERROR',
            error: 'Ordem cancelada: estratégia pausada/desativada',
          });
          this.logger.log(`[STRATEGY DELETE] Cancelled pending LIMIT order ${trade.exchangeOrderId} for trade ${trade.id}`);
        } catch (e: any) {
          this.logger.warn(`[STRATEGY DELETE] Failed to cancel pending order ${trade.exchangeOrderId}: ${e.message}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[STRATEGY DELETE] Failed to cancel pending orders for strategy ${id}: ${e.message}`);
    }
  }

  async updateCredentials(id: string, apiKey: string, apiSecret: string): Promise<{ success: boolean; message: string }> {
    const strategy = await this.strategiesRepository.findOneBy({ id });
    if (!strategy) {
      return { success: false, message: 'Strategy not found' };
    }

    const encryptedKey = await EncryptionUtil.encrypt(apiKey);
    const encryptedSecret = await EncryptionUtil.encrypt(apiSecret);

    await this.strategiesRepository.update(id, {
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
    });

    this.logger.log(`[CREDENTIALS] Updated credentials for strategy ${strategy.name} (${id})`);

    return {
      success: true,
      message: `Credentials updated for ${strategy.name}. Restart backend to activate WebSocket.`,
    };
  }

  async getOpenOrders(id: string): Promise<any> {
    const strategy = await this.findOne(id);
    if (!strategy) {
      throw new Error('Strategy not found');
    }
    const credentials = await this.credentialsResolver.resolveCredentials(strategy);
    const resolvedStrategy = { ...strategy, ...credentials };

    const apiKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();
    const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
    const client = this.exchangeFactory.get(exchange);
    const ctx = toAccountContext(resolvedStrategy, apiKey, apiSecret);

    const result: any = {
      strategy: {
        id: resolvedStrategy.id,
        name: resolvedStrategy.name,
        exchange,
        isTestnet: resolvedStrategy.isTestnet,
        isRealAccount: resolvedStrategy.isRealAccount,
      },
      openOrders: [],
      openPositions: [],
    };

    if (!resolvedStrategy.isTestnet && resolvedStrategy.isRealAccount) {
      result.accountMode = 'REAL ACCOUNT';
      this.logger.warn(`🚨 [REAL ACCOUNT] Checking open orders for strategy: ${resolvedStrategy.name}`);
    } else {
      result.accountMode = resolvedStrategy.isTestnet ? 'TESTNET' : 'MAINNET';
    }

    try {
      const orders = await client.getOpenOrders(ctx);
      result.openOrders = orders.map((order) => ({
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: order.orderType,
        price: parseFloat(order.price),
        quantity: parseFloat(order.qty),
        status: order.orderStatus,
      }));

      const positions = await client.getPositions(ctx);
      result.openPositions = positions
        .filter((pos) => parseFloat(pos.size) > 0)
        .map((pos) => ({
          symbol: pos.symbol,
          side: exchange === Exchange.BYBIT ? (pos.side === 'BUY' ? 'Buy' : 'Sell') : (pos.side === 'BUY' ? 'LONG' : 'SHORT'),
          size: parseFloat(pos.size),
          entryPrice: parseFloat(pos.avgPrice),
          unrealizedPnl: parseFloat(pos.unrealizedPnl),
          leverage: parseFloat(pos.leverage),
        }));

      this.logger.log(
        `[ORDERS CHECK] ${resolvedStrategy.name}: ${result.openOrders.length} open orders, ${result.openPositions.length} open positions`
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to fetch open orders: ${error.message}`);
      throw error;
    }
  }
}
