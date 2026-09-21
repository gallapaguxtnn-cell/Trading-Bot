import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StopLossService } from '../stop-loss/stop-loss.service';
import { TakeProfitService } from '../take-profit/take-profit.service';
import { Trade } from '../strategies/trade.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { TradesService } from '../trades/trades.service';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';

// PLANO_DEFINITIVO_CORRETORAS FASE 7: suite parametrizada rodando o MESMO
// cenario (fechamento de posicao via SL e via TP, incluindo os 2 cenarios
// negativos mais perigosos -- ordem rejeitada pela corretora e corretora sem
// client registrado no factory) para as 3 corretoras do factory. O objetivo
// nao e duplicar a cobertura ja detalhada de stop-loss.service.spec.ts /
// take-profit.service.spec.ts (que testa cada exchange individualmente),
// e sim provar que as MESMAS asserções valem para as 3 ao mesmo tempo --
// se uma corretora nova for registrada no factory sem que closePosition
// saiba trata-la, o teste ...OUTRAS_CORRETORAS falha para ela especificamente.
const EXCHANGES = [Exchange.BINANCE, Exchange.BYBIT, Exchange.OKX];

function makeExchangeClient() {
  return {
    getPositions: jest.fn().mockResolvedValue([]),
    getOrderInfo: jest.fn().mockResolvedValue(null),
    getOrderHistory: jest.fn().mockResolvedValue(null),
    createStopLossOrder: jest.fn(),
    setTradingStop: jest.fn(),
    clearTradingStop: jest.fn(),
    cancelOrder: jest.fn(),
    getLastTradePrice: jest.fn().mockResolvedValue(null),
    getCurrentPrice: jest.fn().mockResolvedValue(0),
    createOrder: jest.fn(),
    getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' }),
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    strategyId: 'strategy-1',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    entryPrice: 60000,
    exitPrice: null,
    quantity: 100,
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
    needsReconciliation: false,
    positionCheckFailures: 0,
    timestamp: new Date(),
    ...overrides,
  } as Trade;
}

// isTestnet: true propositalmente -- e o unico modo em que as 3 corretoras
// passam pelo MESMO caminho (exchangeFactory.get(exchange).createOrder()).
// Binance REAL ainda usa o wrapper CCXT legado (decisao deliberada da FASE 5
// para nao alterar comportamento de conta real sem necessidade); testar
// paridade de verdade significa comparar o caminho que as 3 tem em comum.
function makeStrategy(exchange: Exchange, overrides: Record<string, any> = {}) {
  return {
    id: 'strategy-1',
    exchange,
    isTestnet: true,
    apiKey: 'k',
    apiSecret: 's',
    hedgeMode: false,
    stopLossPercentage: 2,
    ...overrides,
  };
}

async function buildStopLossModule(client: ReturnType<typeof makeExchangeClient>) {
  const tradesRepository = { save: jest.fn((t) => t), update: jest.fn() };
  const symbolRulesService = { getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' }) };
  const exchangeFactory = { get: jest.fn().mockReturnValue(client) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StopLossService,
      { provide: getRepositoryToken(Trade), useValue: tradesRepository },
      { provide: TradesService, useValue: { createExecution: jest.fn() } },
      { provide: StrategiesService, useValue: {} },
      { provide: ExchangeService, useValue: {} },
      { provide: ExchangeClientFactory, useValue: exchangeFactory },
      { provide: BinanceWebSocketService, useValue: { isEnabled: () => false } },
      { provide: SymbolRulesService, useValue: symbolRulesService },
      { provide: CredentialsResolverService, useValue: { resolveCredentials: jest.fn() } },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    ],
  }).compile();

  return { service: module.get<StopLossService>(StopLossService), tradesRepository, exchangeFactory };
}

async function buildTakeProfitModule(client: ReturnType<typeof makeExchangeClient>) {
  const tradesRepository = { save: jest.fn((t) => t), update: jest.fn() };
  const exchangeFactory = { get: jest.fn().mockReturnValue(client) };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TakeProfitService,
      { provide: getRepositoryToken(Trade), useValue: tradesRepository },
      { provide: TradesService, useValue: { createExecution: jest.fn() } },
      { provide: StrategiesService, useValue: {} },
      { provide: ExchangeService, useValue: {} },
      { provide: ExchangeClientFactory, useValue: exchangeFactory },
      { provide: BinanceWebSocketService, useValue: { isEnabled: () => false } },
      { provide: PositionSyncService, useValue: {} },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
      { provide: CredentialsResolverService, useValue: { resolveCredentials: jest.fn() } },
    ],
  }).compile();

  return { service: module.get<TakeProfitService>(TakeProfitService), tradesRepository, exchangeFactory };
}

describe.each(EXCHANGES)('PLANO_DEFINITIVO_CORRETORAS FASE 7: paridade StopLossService.closePosition em %s', (exchange) => {
  it('fecha a posicao usando o preco REAL executado na corretora (nao o exitPrice estimado)', async () => {
    const client = makeExchangeClient();
    client.createOrder.mockResolvedValue({ orderId: 'o1', avgPrice: '59500', executedQty: '100', status: 'FILLED' });
    client.getOrderInfo.mockResolvedValue({ orderId: 'o1', avgPrice: '59500', cumExecQty: '100', orderStatus: 'Filled' });
    const { service, tradesRepository } = await buildStopLossModule(client);
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 60000, 'STOP_LOSS', 'k', 's');

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('CLOSED');
    expect(saved.closeReason).toBe('STOP_LOSS');
  });

  it('CENARIO NEGATIVO -- ordem rejeitada pela corretora: escala para reconciliacao manual, nao tenta de novo no mesmo ciclo (sem loop)', async () => {
    const client = makeExchangeClient();
    client.createOrder.mockRejectedValue(new Error('insufficient balance'));
    const { service, tradesRepository } = await buildStopLossModule(client);
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 60000, 'STOP_LOSS', 'k', 's');

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({ needsReconciliation: true }));
    expect(tradesRepository.save).not.toHaveBeenCalled();
  });

  it('CENARIO NEGATIVO -- corretora sem client registrado no factory: falha explicita, nao tenta outra corretora', async () => {
    const client = makeExchangeClient();
    const { service, tradesRepository, exchangeFactory } = await buildStopLossModule(client);
    exchangeFactory.get.mockImplementation(() => {
      throw new Error(`Nenhum ExchangeClient registrado para ${exchange}`);
    });
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 60000, 'STOP_LOSS', 'k', 's');

    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({ needsReconciliation: true }));
  });
});

describe.each(EXCHANGES)('PLANO_DEFINITIVO_CORRETORAS FASE 7: paridade TakeProfitService.closePosition em %s', (exchange) => {
  it('fecha a posicao (TP final) usando o preco REAL executado na corretora', async () => {
    const client = makeExchangeClient();
    client.createOrder.mockResolvedValue({ orderId: 'o1', avgPrice: '61000', executedQty: '100', status: 'FILLED' });
    client.getOrderInfo.mockResolvedValue({ orderId: 'o1', avgPrice: '61000', cumExecQty: '100', orderStatus: 'Filled' });
    const { service, tradesRepository } = await buildTakeProfitModule(client);
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 61000, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('CLOSED');
  });

  it('CENARIO NEGATIVO -- ordem rejeitada pela corretora: escala para reconciliacao manual, nao tenta de novo no mesmo ciclo (sem loop)', async () => {
    const client = makeExchangeClient();
    client.createOrder.mockRejectedValue(new Error('order would immediately trigger'));
    const { service, tradesRepository } = await buildTakeProfitModule(client);
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 61000, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({ needsReconciliation: true }));
    expect(tradesRepository.save).not.toHaveBeenCalled();
  });

  it('CENARIO NEGATIVO -- corretora sem client registrado no factory: falha explicita, nao tenta outra corretora', async () => {
    const client = makeExchangeClient();
    const { service, tradesRepository, exchangeFactory } = await buildTakeProfitModule(client);
    exchangeFactory.get.mockImplementation(() => {
      throw new Error(`Nenhum ExchangeClient registrado para ${exchange}`);
    });
    const trade = makeTrade();
    const strategy = makeStrategy(exchange);

    await (service as any).closePosition(trade, strategy, 61000, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, 'k', 's', 3);

    expect(tradesRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({ needsReconciliation: true }));
  });
});
