jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditorService } from './auditor.service';
import { AuditLog, AuditCategory, AuditSeverity } from './audit-log.entity';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { Strategy } from '../strategies/strategy.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';

function makeQueryBuilder(strategy: any) {
  return {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(strategy),
  };
}

describe('AuditorService (FASE 5 -- TP_EXECUTED_AT_MARKET)', () => {
  let service: AuditorService;
  let auditRepo: { save: jest.Mock };
  let tradeRepo: { findOne: jest.Mock };
  let execRepo: { find: jest.Mock };
  let strategyRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    auditRepo = { save: jest.fn() };
    tradeRepo = { findOne: jest.fn() };
    execRepo = { find: jest.fn().mockResolvedValue([]) };
    strategyRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(TradeExecution), useValue: execRepo },
        { provide: getRepositoryToken(Strategy), useValue: strategyRepo },
        { provide: ExchangeService, useValue: {} },
        {
          provide: CredentialsResolverService,
          useValue: {
            resolveCredentials: jest.fn((strategy: any) =>
              Promise.resolve({
                apiKey: strategy.apiKey,
                apiSecret: strategy.apiSecret,
                exchange: strategy.exchange,
                isTestnet: strategy.isTestnet,
                isRealAccount: strategy.isRealAccount,
                portfolioId: null,
                source: 'strategy',
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<AuditorService>(AuditorService);
  });

  it('emite TP_EXECUTED_AT_MARKET (WARNING) para um trade fechado via fallback, com alvo x executado x diff', async () => {
    const trade = {
      id: 'trade-1',
      strategyId: 'strategy-1',
      symbol: 'SUIUSDT',
      side: 'SELL',
      status: 'CLOSED',
      entryPrice: 0.7546,
      exitPrice: 0.7535,
      closeReason: 'TAKE_PROFIT_FALLBACK_MARKET',
      closeDetail: 'TARGET:0.75234',
      quantity: 60,
      pnl: 6.6,
      exchangeOrderId: null,
      stopLossOrderId: null,
      takeProfitOrderId: null,
      timestamp: new Date(),
    } as unknown as Trade;

    tradeRepo.findOne.mockResolvedValue(trade);
    strategyRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder({ id: 'strategy-1', apiKey: null, apiSecret: null }));

    const result = await service.reconcileTrade('trade-1');

    const issue = result.issues.find(i => i.category === AuditCategory.TP_EXECUTED_AT_MARKET);
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe(AuditSeverity.WARNING);
    expect(issue!.expectedValue).toBeCloseTo(0.75234, 8);
    expect(issue!.actualValue).toBeCloseTo(0.7535, 8);
    expect(issue!.message).toContain('mercado');
  });

  it('nao emite TP_EXECUTED_AT_MARKET para um TP fechado normalmente no alvo LIMIT', async () => {
    const trade = {
      id: 'trade-2',
      strategyId: 'strategy-1',
      symbol: 'SUIUSDT',
      side: 'SELL',
      status: 'CLOSED',
      entryPrice: 0.7546,
      exitPrice: 0.75234,
      closeReason: 'TAKE_PROFIT_3',
      closeDetail: null,
      quantity: 60,
      pnl: 6.6,
      exchangeOrderId: null,
      stopLossOrderId: null,
      takeProfitOrderId: null,
      timestamp: new Date(),
    } as unknown as Trade;

    tradeRepo.findOne.mockResolvedValue(trade);
    strategyRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder({
      id: 'strategy-1', apiKey: null, apiSecret: null, takeProfitPercentage3: 0.3,
    }));

    const result = await service.reconcileTrade('trade-2');

    expect(result.issues.find(i => i.category === AuditCategory.TP_EXECUTED_AT_MARKET)).toBeUndefined();
  });
});

describe('AuditorService (FASE 2 -- CredentialsResolver)', () => {
  let service: AuditorService;
  let strategyRepo: { createQueryBuilder: jest.Mock };
  let tradeRepo: { findOne: jest.Mock };
  let execRepo: { find: jest.Mock };
  let exchangeService: { getExchange: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };

  beforeEach(async () => {
    strategyRepo = { createQueryBuilder: jest.fn() };
    tradeRepo = { findOne: jest.fn() };
    execRepo = { find: jest.fn().mockResolvedValue([]) };
    exchangeService = { getExchange: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorService,
        { provide: getRepositoryToken(AuditLog), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(TradeExecution), useValue: execRepo },
        { provide: getRepositoryToken(Strategy), useValue: strategyRepo },
        { provide: ExchangeService, useValue: exchangeService },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<AuditorService>(AuditorService);
  });

  it('reconcileTrade com portfolio: busca a ordem na corretora usando as credenciais/exchange do portfolio', async () => {
    const trade = {
      id: 'trade-1',
      strategyId: 'strategy-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      status: 'OPEN',
      entryPrice: 60000,
      exitPrice: null,
      closeReason: null,
      closeDetail: null,
      quantity: 1,
      pnl: null,
      exchangeOrderId: 'order-1',
      stopLossOrderId: null,
      takeProfitOrderId: null,
      timestamp: new Date(),
    } as unknown as Trade;

    tradeRepo.findOne.mockResolvedValue(trade);
    strategyRepo.createQueryBuilder.mockReturnValue(
      makeQueryBuilder({ id: 'strategy-1', exchange: 'binance', isTestnet: true, apiKey: 'legacy', apiSecret: 'legacy', portfolioId: 'p1' }),
    );
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'portfolio-key',
      apiSecret: 'portfolio-secret',
      exchange: 'bybit',
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'p1',
      source: 'portfolio',
    });
    const fetchOrder = jest.fn().mockResolvedValue({ id: 'order-1', price: 60000, average: 60000, filled: 1, fee: { cost: 0.1, currency: 'USDT' }, status: 'closed', timestamp: Date.now() });
    exchangeService.getExchange.mockResolvedValue({ fetchOrder, fetchMyTrades: jest.fn().mockResolvedValue([]) });

    await service.reconcileTrade('trade-1');

    expect(exchangeService.getExchange).toHaveBeenCalledWith('bybit', 'portfolio-key', 'portfolio-secret', false);
  });
});
