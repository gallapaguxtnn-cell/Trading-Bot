jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TakeProfitService } from './take-profit.service';
import { Trade } from '../strategies/trade.entity';
import { TradesService } from '../trades/trades.service';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { Exchange } from '../strategies/strategy.entity';

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

function makeStrategy(overrides: Record<string, any> = {}) {
  return {
    id: 'strategy-1',
    exchange: Exchange.BYBIT,
    isTestnet: true,
    apiKey: 'fake-key',
    apiSecret: 'fake-secret',
    takeProfitPercentage1: 0.3,
    takeProfitQuantity1: 33,
    takeProfitPercentage2: 0.6,
    takeProfitQuantity2: 33,
    takeProfitPercentage3: 1.0,
    hedgeMode: false,
    ...overrides,
  };
}

describe('TakeProfitService (FASE 1 -- fallback nao substitui o TP LIMIT)', () => {
  let service: TakeProfitService;
  let tradesRepository: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock; save: jest.Mock };
  let strategiesService: { findOne: jest.Mock };
  let bybitClient: { getCurrentPrice: jest.Mock; createOrder: jest.Mock; getSymbolRules: jest.Mock; getPositionIdx: jest.Mock; getPositions: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    tradesRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
    };
    strategiesService = { findOne: jest.fn() };
    bybitClient = {
      getCurrentPrice: jest.fn(),
      createOrder: jest.fn(),
      getSymbolRules: jest.fn(),
      getPositionIdx: jest.fn(),
      getPositions: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TakeProfitService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: TradesService, useValue: { createExecution: jest.fn(), findById: jest.fn() } },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
        { provide: BinanceWebSocketService, useValue: { isEnabled: () => false } },
        { provide: PositionSyncService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<TakeProfitService>(TakeProfitService);
  });

  it('trade OPEN sem takeProfitOrderId nao fecha a mercado: emite limit.protection.resume e persiste o contador de tentativas', async () => {
    const trade = makeTrade({ tpWarnings: null });
    strategiesService.findOne.mockResolvedValue(makeStrategy());

    await (service as any).checkTakeProfit(trade);

    expect(eventEmitter.emit).toHaveBeenCalledWith('limit.protection.resume', { tradeId: 'trade-1' });
    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', { tpWarnings: 'TP_MISSING_RETRY:1' });
    expect(bybitClient.createOrder).not.toHaveBeenCalled();
    expect(bybitClient.getCurrentPrice).not.toHaveBeenCalled();
  });

  it('continua emitindo resume e incrementando o contador enquanto abaixo do limite de tentativas', async () => {
    const trade = makeTrade({ tpWarnings: 'TP_MISSING_RETRY:1' });
    strategiesService.findOne.mockResolvedValue(makeStrategy());

    await (service as any).checkTakeProfit(trade);

    expect(eventEmitter.emit).toHaveBeenCalledWith('limit.protection.resume', { tradeId: 'trade-1' });
    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', { tpWarnings: 'TP_MISSING_RETRY:2' });
    expect(bybitClient.createOrder).not.toHaveBeenCalled();
  });

  it('apos 3 ciclos sem conseguir criar as LIMIT, libera o fallback a mercado com closeReason TAKE_PROFIT_FALLBACK_MARKET', async () => {
    const trade = makeTrade({ tpWarnings: 'TP_MISSING_RETRY:3', lastTpLevel: 2 });
    strategiesService.findOne.mockResolvedValue(makeStrategy());
    bybitClient.getCurrentPrice.mockResolvedValue(0.746);
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', minQty: '1', priceTick: '0.0001', minNotional: '5' });
    bybitClient.getPositionIdx.mockResolvedValue(0);
    bybitClient.createOrder.mockResolvedValue({ orderId: 'market-close-1' });

    await (service as any).checkTakeProfit(trade);

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(bybitClient.createOrder).toHaveBeenCalledWith(
      'fake-key', 'fake-secret', true,
      expect.objectContaining({ symbol: 'SUIUSDT', orderType: 'Market', reduceOnly: true }),
    );

    const savedTrade = tradesRepository.save.mock.calls[0][0];
    expect(savedTrade.closeReason).toBe('TAKE_PROFIT_FALLBACK_MARKET');
    expect(savedTrade.status).toBe('CLOSED');
  });

  it('nao emite resume nem fallback quando a estrategia nao tem nenhum TP configurado (sem TP por design)', async () => {
    const trade = makeTrade({ tpWarnings: null });
    strategiesService.findOne.mockResolvedValue(makeStrategy({
      takeProfitPercentage1: null,
      takeProfitPercentage2: null,
      takeProfitPercentage3: null,
    }));

    await (service as any).checkTakeProfit(trade);

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(tradesRepository.update).not.toHaveBeenCalled();
    expect(bybitClient.createOrder).not.toHaveBeenCalled();
  });
});

describe('TakeProfitService (FASE 4 -- closePosition)', () => {
  let service: TakeProfitService;
  let tradesRepository: { update: jest.Mock; save: jest.Mock };
  let tradesService: { createExecution: jest.Mock };
  let bybitClient: { createOrder: jest.Mock; getSymbolRules: jest.Mock; getPositionIdx: jest.Mock; getOrderInfo: jest.Mock; getOrderHistory: jest.Mock };

  beforeEach(async () => {
    tradesRepository = { update: jest.fn(), save: jest.fn() };
    tradesService = { createExecution: jest.fn() };
    bybitClient = {
      createOrder: jest.fn(),
      getSymbolRules: jest.fn(),
      getPositionIdx: jest.fn().mockResolvedValue(0),
      getOrderInfo: jest.fn(),
      getOrderHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TakeProfitService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: TradesService, useValue: tradesService },
        { provide: StrategiesService, useValue: { findOne: jest.fn() } },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
        { provide: BinanceWebSocketService, useValue: { isEnabled: () => false } },
        { provide: PositionSyncService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<TakeProfitService>(TakeProfitService);
  });

  it('fatia abaixo de minQty numa parcial (TP1) NAO fecha a posicao inteira: pula o nivel e avanca lastTpLevel sem criar ordem', async () => {
    const trade = makeTrade({ quantity: 100 });
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', minQty: '5', priceTick: '0.0001', minNotional: '5' });

    await (service as any).closePosition(trade, makeStrategy(), 0.75, 'TAKE_PROFIT_FALLBACK_MARKET', 0.03, 'k', 's', 1);

    expect(bybitClient.createOrder).not.toHaveBeenCalled();
    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', { lastTpLevel: 1 });
    expect(tradesRepository.save).not.toHaveBeenCalled();
  });

  it('fatia abaixo de minQty mas a posicao TOTAL tambem e dust (nivel final): fecha tudo como DUST_AMOUNT (comportamento preservado)', async () => {
    const trade = makeTrade({ quantity: 0.5 });
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', minQty: '5', priceTick: '0.0001', minNotional: '5' });

    await (service as any).closePosition(trade, makeStrategy(), 0.75, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    expect(bybitClient.createOrder).not.toHaveBeenCalled();
    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('CLOSED');
    expect(saved.closeReason).toBe('DUST_AMOUNT');
    expect(saved.excludeFromStats).toBe(true);
  });

  it('normaliza a quantidade pelo qtyStep real com Decimal, nao toFixed(3): step 10 nunca envia fracao', async () => {
    const trade = makeTrade({ quantity: 253 });
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '10', minQty: '10', priceTick: '0.0001', minNotional: '5' });
    bybitClient.createOrder.mockResolvedValue({ orderId: 'order-1' });
    bybitClient.getOrderInfo.mockResolvedValue(null);
    bybitClient.getOrderHistory.mockResolvedValue(null);

    await (service as any).closePosition(trade, makeStrategy(), 0.75, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    expect(bybitClient.createOrder).toHaveBeenCalledWith('k', 's', true, expect.objectContaining({ qty: '250' }));
  });

  it('usa o preco REALMENTE executado (avgPrice da corretora) para exitPrice e PnL, nao o exitPrice estimado passado como parametro', async () => {
    const trade = makeTrade({ quantity: 60, entryPrice: 0.7546, side: 'SELL' });
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', minQty: '1', priceTick: '0.0001', minNotional: '5' });
    bybitClient.createOrder.mockResolvedValue({ orderId: 'order-1' });
    bybitClient.getOrderInfo.mockResolvedValue({
      orderStatus: 'Filled',
      avgPrice: '0.7535',
      cumExecQty: '60',
      cumExecFee: '0.01',
      updatedTime: `${Date.now()}`,
    });

    const estimatedExitPrice = 0.752;
    await (service as any).closePosition(trade, makeStrategy(), estimatedExitPrice, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    const saved = tradesRepository.save.mock.calls[0][0];
    expect(Number(saved.exitPrice)).toBe(0.7535);
    expect(Number(saved.exitPrice)).not.toBe(estimatedExitPrice);

    const execution = tradesService.createExecution.mock.calls[0][0];
    expect(execution.price).toBe(0.7535);
  });
});
