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

type StrategyWireInput = Omit<
  Partial<Strategy>,
  'legacyExchange' | 'legacyApiKey' | 'legacyApiSecret' | 'legacyIsTestnet' | 'legacyIsRealAccount'
> & {
  exchange?: Exchange;
  apiKey?: string;
  apiSecret?: string;
  isTestnet?: boolean;
  isRealAccount?: boolean;
};

type StrategyWireShape<T> = Omit<T, 'legacyExchange' | 'legacyIsTestnet' | 'legacyIsRealAccount'> & {
  exchange: Exchange;
  isTestnet: boolean;
  isRealAccount: boolean;
};

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

  private async attachPortfolioSummaries<T extends { portfolioId: string | null }>(
    strategies: T[],
  ): Promise<Array<T & { portfolio: PortfolioSummary | null }>> {
    const portfolioIds = [...new Set(strategies.map((s) => s.portfolioId).filter((id): id is string => !!id))];
    const summaries = await this.portfoliosService.findSummariesByIds(portfolioIds);
    return strategies.map((s) => ({ ...s, portfolio: s.portfolioId ? summaries.get(s.portfolioId) ?? null : null }));
  }

  private toLegacyWireShape<T extends Pick<Strategy, 'legacyExchange' | 'legacyIsTestnet' | 'legacyIsRealAccount'>>(
    strategy: T,
  ): StrategyWireShape<T> {
    const { legacyExchange, legacyIsTestnet, legacyIsRealAccount, ...rest } = strategy;
    return { ...rest, exchange: legacyExchange, isTestnet: legacyIsTestnet, isRealAccount: legacyIsRealAccount } as StrategyWireShape<T>;
  }

  async findAll(): Promise<Array<StrategyWireShape<Strategy & { portfolio: PortfolioSummary | null }>>> {
    const strategies = await this.strategiesRepository.find();
    const withPortfolio = await this.attachPortfolioSummaries(strategies);
    return withPortfolio.map((s) => this.toLegacyWireShape(s));
  }

  findAllWithCredentials(): Promise<Strategy[]> {
    return this.strategiesRepository
      .createQueryBuilder('strategy')
      .addSelect(['strategy.legacyApiKey', 'strategy.legacyApiSecret'])
      .getMany();
  }

  findOne(id: string): Promise<Strategy | null> {
    return this.strategiesRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'asset',
        'legacyExchange',
        'direction',
        'isActive',
        'legacyIsTestnet',
        'legacyIsRealAccount',
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
        'legacyApiKey',
        'legacyApiSecret',
        'portfolioId'
      ]
    });
  }

  async findOnePublic(id: string): Promise<StrategyWireShape<Strategy & { portfolio: PortfolioSummary | null }> | null> {
    const strategy = await this.strategiesRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'asset',
        'legacyExchange',
        'direction',
        'isActive',
        'legacyIsTestnet',
        'legacyIsRealAccount',
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
    return this.toLegacyWireShape(withPortfolio);
  }

  async create(input: StrategyWireInput): Promise<Strategy> {
    this.logger.log(
      `[STRATEGY CREATE] Risk values received:\n` +
      `  SL%: ${input.stopLossPercentage} (type: ${typeof input.stopLossPercentage})\n` +
      `  TP1%: ${input.takeProfitPercentage1} (type: ${typeof input.takeProfitPercentage1})\n` +
      `  TP2%: ${input.takeProfitPercentage2} (type: ${typeof input.takeProfitPercentage2})\n` +
      `  TP3%: ${input.takeProfitPercentage3} (type: ${typeof input.takeProfitPercentage3})`
    );
    const newStrategy = this.strategiesRepository.create(await this.toLegacyEntityShape(input));
    return this.strategiesRepository.save(newStrategy);
  }

  async update(id: string, input: StrategyWireInput): Promise<Strategy | null> {
    this.logger.log(
      `[STRATEGY UPDATE] Risk values received:\n` +
      `  SL%: ${input.stopLossPercentage} (type: ${typeof input.stopLossPercentage})\n` +
      `  TP1%: ${input.takeProfitPercentage1} (type: ${typeof input.takeProfitPercentage1})\n` +
      `  TP2%: ${input.takeProfitPercentage2} (type: ${typeof input.takeProfitPercentage2})\n` +
      `  TP3%: ${input.takeProfitPercentage3} (type: ${typeof input.takeProfitPercentage3})`
    );
    await this.strategiesRepository.update(id, await this.toLegacyEntityShape(input));
    this.credentialsResolver.invalidate(id);
    return this.strategiesRepository.findOneBy({ id });
  }

  private async toLegacyEntityShape(input: StrategyWireInput): Promise<Partial<Strategy>> {
    const { exchange, apiKey, apiSecret, isTestnet, isRealAccount, ...rest } = input;
    const entity: Partial<Strategy> = { ...rest };
    if (exchange !== undefined) entity.legacyExchange = exchange;
    if (isTestnet !== undefined) entity.legacyIsTestnet = isTestnet;
    if (isRealAccount !== undefined) entity.legacyIsRealAccount = isRealAccount;
    if (apiKey) entity.legacyApiKey = await EncryptionUtil.encrypt(apiKey);
    if (apiSecret) entity.legacyApiSecret = await EncryptionUtil.encrypt(apiSecret);
    return entity;
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
      legacyApiKey: encryptedKey,
      legacyApiSecret: encryptedSecret,
    });
    this.credentialsResolver.invalidate(id);

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
