jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TakeProfitService } from './take-profit.service';
import { AuditorService } from '../auditor/auditor.service';
import { AuditLog, AuditCategory, AuditSeverity } from '../auditor/audit-log.entity';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { TradesService } from '../trades/trades.service';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';

function passthroughCredentialsResolver() {
  return {
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
  };
}

describe('Cenario de aceite: PLANO_FIX_TP_MARKET_FALLBACK (print real SUIUSDT SHORT, 28/08)', () => {
  let takeProfitService: TakeProfitService;
  let auditorService: AuditorService;
  let tradesRepository: { update: jest.Mock; save: jest.Mock };
  let strategiesService: { findOne: jest.Mock };
  let bybitClient: {
    getCurrentPrice: jest.Mock;
    createOrder: jest.Mock;
    getSymbolRules: jest.Mock;
    getPositionIdx: jest.Mock;
    getOrderInfo: jest.Mock;
    getOrderHistory: jest.Mock;
  };
  let eventEmitter: { emit: jest.Mock };
  let tradesServiceMock: { createExecution: jest.Mock };

  const strategy = {
    id: 'strategy-1',
    exchange: Exchange.BYBIT,
    isTestnet: true,
    apiKey: 'fake-key',
    apiSecret: 'fake-secret',
    takeProfitPercentage1: 0.3,
    takeProfitQuantity1: 100,
    takeProfitPercentage2: null,
    takeProfitPercentage3: null,
    hedgeMode: false,
  };

  function makeTrade(overrides: Partial<Trade> = {}): Trade {
    return {
      id: 'trade-1',
      strategyId: 'strategy-1',
      symbol: 'SUIUSDT',
      side: 'SELL',
      type: 'LIMIT',
      entryPrice: 0.7546,
      exitPrice: null,
      quantity: 60,
      pnl: null,
      status: 'OPEN',
      exchangeOrderId: 'entry-1',
      stopLossOrderId: 'sl-1',
      takeProfitOrderId: null,
      closeReason: null,
      closeDetail: null,
      closedAt: null,
      pendingExpiresAt: null,
      binancePositionAmt: null,
      error: null,
      currentStopLoss: null,
      isFromAveraging: false,
      lastTpLevel: 0,
      initialQuantity: null,
      origin: null,
      excludeFromStats: false,
      tpWarnings: null,
      timestamp: new Date(),
      ...overrides,
    } as Trade;
  }

  beforeEach(async () => {
    tradesRepository = { update: jest.fn(), save: jest.fn() };
    strategiesService = { findOne: jest.fn().mockResolvedValue(strategy) };
    bybitClient = {
      getCurrentPrice: jest.fn(),
      createOrder: jest.fn(),
      getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', minQty: '1', priceTick: '0.0001', minNotional: '5' }),
      getPositionIdx: jest.fn().mockResolvedValue(0),
      getOrderInfo: jest.fn(),
      getOrderHistory: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };
    tradesServiceMock = { createExecution: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TakeProfitService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: TradesService, useValue: tradesServiceMock },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
        { provide: BinanceWebSocketService, useValue: { isEnabled: () => false } },
        { provide: PositionSyncService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    takeProfitService = module.get<TakeProfitService>(TakeProfitService);
  });

  it('3 ciclos pedindo para recriar o TP LIMIT, depois fallback a mercado no 4o -- exatamente o preco/target do incidente', async () => {
    let trade = makeTrade({ tpWarnings: null });

    for (let cycle = 1; cycle <= 3; cycle++) {
      await (takeProfitService as any).checkTakeProfit(trade);
      expect(eventEmitter.emit).toHaveBeenNthCalledWith(cycle, 'limit.protection.resume', { tradeId: 'trade-1' });
      const [, update] = tradesRepository.update.mock.calls[cycle - 1];
      expect(update).toEqual({ tpWarnings: `TP_MISSING_RETRY:${cycle}` });
      trade = makeTrade({ tpWarnings: update.tpWarnings });
    }

    expect(bybitClient.createOrder).not.toHaveBeenCalled();

    bybitClient.getCurrentPrice.mockResolvedValue(0.752);
    bybitClient.createOrder.mockResolvedValue({ orderId: 'market-close-1' });
    bybitClient.getOrderInfo.mockResolvedValue({
      orderStatus: 'Filled',
      avgPrice: '0.7535',
      cumExecQty: '60',
      cumExecFee: '0.018',
      updatedTime: `${Date.now()}`,
    });

    await (takeProfitService as any).checkTakeProfit(trade);

    expect(eventEmitter.emit).toHaveBeenCalledTimes(3);
    expect(bybitClient.createOrder).toHaveBeenCalledWith(
      'fake-key', 'fake-secret', true,
      expect.objectContaining({ symbol: 'SUIUSDT', orderType: 'Market', reduceOnly: true }),
    );

    const closedTrade = tradesRepository.save.mock.calls[0][0];
    expect(closedTrade.status).toBe('CLOSED');
    expect(closedTrade.closeReason).toBe('TAKE_PROFIT_FALLBACK_MARKET');
    expect(Number(closedTrade.exitPrice)).toBe(0.7535);
    expect(closedTrade.closeDetail).toBe('TARGET:0.7523362');

    const auditModule: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorService,
        { provide: getRepositoryToken(AuditLog), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(Trade), useValue: { findOne: jest.fn().mockResolvedValue(closedTrade) } },
        { provide: getRepositoryToken(TradeExecution), useValue: { find: jest.fn().mockResolvedValue([]) } },
        {
          provide: getRepositoryToken(Strategy), useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue({ id: 'strategy-1', apiKey: null, apiSecret: null }),
            }),
          },
        },
        { provide: ExchangeService, useValue: {} },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    auditorService = auditModule.get<AuditorService>(AuditorService);
    const result = await auditorService.reconcileTrade('trade-1');

    const marketIssue = result.issues.find(i => i.category === AuditCategory.TP_EXECUTED_AT_MARKET);
    expect(marketIssue).toBeDefined();
    expect(marketIssue!.severity).toBe(AuditSeverity.WARNING);
    expect(marketIssue!.expectedValue).toBeCloseTo(0.7523362, 6);
    expect(marketIssue!.actualValue).toBeCloseTo(0.7535, 8);

    const realizedPct = ((0.7546 - 0.7535) / 0.7546) * 100;
    expect(realizedPct).toBeCloseTo(0.1458, 3);
  });
});
