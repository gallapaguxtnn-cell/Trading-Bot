import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionSyncService } from './position-sync.service';
import { Trade } from '../strategies/trade.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { TradesService } from '../trades/trades.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { EncryptionUtil } from '../utils/encryption.util';
import type { ResolvedStrategy } from '../common/resolved-strategy.type';

function makeExchangeClient() {
  return {
    getPositions: jest.fn().mockResolvedValue([]),
    getOpenOrders: jest.fn(),
    getOrderInfo: jest.fn().mockResolvedValue(null),
    getOrderHistory: jest.fn().mockResolvedValue(null),
    cancelOrder: jest.fn().mockResolvedValue(true),
    cancelAllOrders: jest.fn().mockResolvedValue(true),
    createOrder: jest.fn(),
    createStopLossOrder: jest.fn().mockResolvedValue({ orderId: 'sl-new' }),
    setTradingStop: jest.fn().mockResolvedValue(true),
    clearTradingStop: jest.fn().mockResolvedValue(true),
    getCurrentPrice: jest.fn().mockResolvedValue(0),
    getLastTradePrice: jest.fn().mockResolvedValue(null),
    getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' }),
    getServerTime: jest.fn(),
    setLeverage: jest.fn(),
    setMarginMode: jest.fn(),
    ensurePositionMode: jest.fn(),
    getPositionIdx: jest.fn(),
    detectPositionMode: jest.fn(),
    waitForPosition: jest.fn(),
    getWalletBalance: jest.fn(),
  };
}

describe('PositionSyncService (FASE 3 -- arredondamento via SymbolRulesService)', () => {
  let service: PositionSyncService;
  let symbolRulesService: { getSymbolRules: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let exchangeFactory: { get: jest.Mock };
  let client: ReturnType<typeof makeExchangeClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    client = makeExchangeClient();
    exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    symbolRulesService = { getSymbolRules: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: symbolRulesService },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
  });

  it('normaliza a quantidade pelo qtyStep real da corretora ao recriar o SL na Binance apos break-even (nunca toFixed(2) fixo)', async () => {
    client.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: 60000,
      currentStopLoss: 58800,
      quantity: 253,
      lastTpLevel: 2,
      isFromAveraging: false,
      stopLossOrderId: null,
    } as unknown as Trade;

    const strategy = {
      exchange: Exchange.BINANCE,
      isTestnet: false,
      moveSLToBreakeven: true,
      breakAgain: false,
      hedgeMode: false,
      takeProfitPercentage1: null,
      takeProfitPercentage2: null,
      takeProfitPercentage3: null,
    } as unknown as ResolvedStrategy;

    await service.checkBreakAgain(trade, undefined, strategy, 'key', 'secret');

    expect(client.createStopLossOrder).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'key', apiSecret: 'secret' }, mode: 'REAL' }),
      'BTCUSDT', 'BUY', '250', expect.any(String), false,
    );
  });

  it('aborta a atualizacao do SL (nao envia a ordem) quando a quantidade normalizada arredonda para 0', async () => {
    client.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: 60000,
      currentStopLoss: 58800,
      quantity: 5,
      lastTpLevel: 2,
      isFromAveraging: false,
      stopLossOrderId: null,
    } as unknown as Trade;

    const strategy = {
      exchange: Exchange.BINANCE,
      isTestnet: false,
      moveSLToBreakeven: true,
      breakAgain: false,
      hedgeMode: false,
      takeProfitPercentage1: null,
      takeProfitPercentage2: null,
      takeProfitPercentage3: null,
    } as unknown as ResolvedStrategy;

    await service.checkBreakAgain(trade, undefined, strategy, 'key', 'secret');

    expect(client.createStopLossOrder).not.toHaveBeenCalled();
  });

  it('Bybit sem averaging: usa setTradingStop (SL a nivel de posicao), nao createStopLossOrder', async () => {
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      entryPrice: 60000,
      currentStopLoss: 58800,
      quantity: 1,
      lastTpLevel: 2,
      isFromAveraging: false,
      stopLossOrderId: null,
    } as unknown as Trade;

    const strategy = {
      exchange: Exchange.BYBIT,
      isTestnet: false,
      moveSLToBreakeven: true,
      breakAgain: false,
      hedgeMode: false,
      takeProfitPercentage1: null,
      takeProfitPercentage2: null,
      takeProfitPercentage3: null,
    } as unknown as ResolvedStrategy;

    await service.checkBreakAgain(trade, undefined, strategy, 'key', 'secret', 'BRA_BTL');

    expect(client.setTradingStop).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'BRA_BTL' }),
      'BTCUSDT', 'BUY', expect.any(String), undefined, false,
    );
    expect(client.createStopLossOrder).not.toHaveBeenCalled();
  });
});

describe('PositionSyncService (FASE 2 -- CredentialsResolver)', () => {
  let service: PositionSyncService;
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let exchangeFactory: { get: jest.Mock };
  let client: ReturnType<typeof makeExchangeClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    client = makeExchangeClient();
    exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: { save: jest.fn(), find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
  });

  it('com portfolio: usa exchange/credenciais do portfolio (nao os campos legados) para decidir e consultar a corretora', async () => {
    const strategy = {
      id: 's1',
      name: 'Estrategia X',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      apiKey: 'legacy-enc-key',
      apiSecret: 'legacy-enc-secret',
      portfolioId: 'portfolio-1',
    } as unknown as Strategy;

    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: await EncryptionUtil.encrypt('portfolio-key'),
      apiSecret: await EncryptionUtil.encrypt('portfolio-secret'),
      exchange: Exchange.BYBIT,
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'portfolio-1',
      siteId: null,
      source: 'portfolio',
    });

    await (service as any).syncStrategyPositions(strategy);

    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.BYBIT);
    expect(client.getPositions).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'portfolio-key', apiSecret: 'portfolio-secret', passphrase: null }, mode: 'REAL' }),
    );
  });

  it('sem portfolio: usa exchange/credenciais legadas da estrategia (comportamento atual preservado)', async () => {
    const encryptedKey = await EncryptionUtil.encrypt('legacy-key');
    const encryptedSecret = await EncryptionUtil.encrypt('legacy-secret');
    const strategy = {
      id: 's2',
      name: 'Legada',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      portfolioId: null,
    } as unknown as Strategy;

    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });

    await (service as any).syncStrategyPositions(strategy);

    expect(client.getPositions).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'legacy-key', apiSecret: 'legacy-secret', passphrase: null }, mode: 'DEMO' }),
    );
  });

  it('sem apiKey/apiSecret resolvidos (nem portfolio nem legado): nao tenta sincronizar', async () => {
    const strategy = {
      id: 's3',
      name: 'Sem credenciais',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      apiKey: null,
      apiSecret: null,
      portfolioId: null,
    } as unknown as Strategy;

    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: null,
      apiSecret: null,
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });

    const result = await (service as any).syncStrategyPositions(strategy);

    expect(exchangeFactory.get).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, closed: 0, imported: 0, consolidated: 0 });
  });
});

describe('PositionSyncService (PLANO_FIX_PROTECAO_NAO_CRIADA -- deteccao de orfa escopada por portfolio, nao strategyId)', () => {
  let service: PositionSyncService;
  let tradesRepository: { save: jest.Mock; create: jest.Mock; find: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let exchangeFactory: { get: jest.Mock };
  let client: ReturnType<typeof makeExchangeClient>;

  const openPosition = {
    symbol: 'DOGEUSDT',
    side: 'SELL' as const,
    size: '390.1711',
    avgPrice: '0.0848',
    unrealizedPnl: '0',
    leverage: '50',
    markPrice: '0.0848',
  };

  function makeStrategyRow(overrides: Record<string, any> = {}) {
    return {
      id: 'strategy-A',
      name: 'FF1 1H TEST',
      exchange: Exchange.BYBIT,
      isTestnet: false,
      apiKey: 'enc-key',
      apiSecret: 'enc-secret',
      portfolioId: 'portfolio-shared',
      breakAgain: false,
      moveSLToBreakeven: false,
      ...overrides,
    } as unknown as Strategy;
  }

  function makeCredentials(overrides: Record<string, any> = {}) {
    return {
      apiKey: 'enc-key',
      apiSecret: 'enc-secret',
      exchange: Exchange.BYBIT,
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'portfolio-shared',
      siteId: null,
      source: 'portfolio',
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    client = makeExchangeClient();
    client.getPositions.mockResolvedValue([openPosition]);
    client.getSymbolRules.mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
    exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    credentialsResolver = { resolveCredentials: jest.fn().mockResolvedValue(makeCredentials()) };
    tradesRepository = { save: jest.fn(t => t), create: jest.fn(t => t), find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: getRepositoryToken(Strategy), useValue: { findOne: jest.fn() } },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
  });

  it('posicao ja pertence a um trade OPEN de outra estrategia do MESMO portfolio -> nao importa como orfa (bug real do incidente DOGEUSDT)', async () => {
    const siblingTrade = {
      id: 'trade-31e47dd0',
      strategyId: 'strategy-B',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      status: 'OPEN',
      entryPrice: 0.0848,
      quantity: 390.1711,
      stopLossOrderId: 'sl-real',
      takeProfitOrderId: '1:tp-real',
    };

    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && where.portfolioId === 'portfolio-shared') {
        return [siblingTrade];
      }
      return [];
    });

    const strategyA = makeStrategyRow({ id: 'strategy-A' });
    const result = await (service as any).syncStrategyPositions(strategyA);

    expect(tradesRepository.create).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.synced).toBe(1);
  });

  it('trade encontrado pertence a OUTRA estrategia do portfolio -> nao aplica breakAgain/moveSLToBreakeven da estrategia errada', async () => {
    const siblingTrade = {
      id: 'trade-sibling',
      strategyId: 'strategy-B',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      status: 'OPEN',
      entryPrice: 0.0848,
      quantity: 390.1711,
      currentStopLoss: 0.0852,
      stopLossOrderId: 'sl-real',
      takeProfitOrderId: '1:tp-real',
    };

    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && where.portfolioId === 'portfolio-shared') {
        return [siblingTrade];
      }
      return [];
    });

    const strategyA = makeStrategyRow({ id: 'strategy-A', breakAgain: true, moveSLToBreakeven: true, takeProfitPercentage1: 1 });
    await (service as any).syncStrategyPositions(strategyA);

    expect(client.setTradingStop).not.toHaveBeenCalled();
    expect(client.createStopLossOrder).not.toHaveBeenCalled();
    expect(tradesRepository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'trade-sibling' }));
  });

  it('duplicata cross-strategy no mesmo portfolio (2 trades OPEN, strategyId diferentes) e consolidada em uma so', async () => {
    const primary = {
      id: 'trade-primary',
      strategyId: 'strategy-A',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      status: 'OPEN',
      timestamp: new Date('2026-09-14T17:24:18Z'),
      entryPrice: 0.0848,
      quantity: 390.1711,
      stopLossOrderId: 'sl-real',
      takeProfitOrderId: '1:tp-real',
    };
    const duplicate = {
      id: 'trade-duplicate',
      strategyId: 'strategy-B',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      status: 'OPEN',
      timestamp: new Date('2026-09-14T17:25:00Z'),
      entryPrice: 0.0848,
      quantity: 390.1711,
      stopLossOrderId: null,
      takeProfitOrderId: null,
    };

    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && where.portfolioId === 'portfolio-shared') {
        return [primary, duplicate];
      }
      return [];
    });

    const strategyA = makeStrategyRow({ id: 'strategy-A' });
    const result = await (service as any).syncStrategyPositions(strategyA);

    expect(result.consolidated).toBeGreaterThanOrEqual(1);
    const closedCall = tradesRepository.save.mock.calls.find((c: any) => c[0].id === 'trade-duplicate');
    expect(closedCall[0].status).toBe('CLOSED');
    expect(closedCall[0].excludeFromStats).toBe(true);
  });

  it('estrategia legada sem portfolio (portfolioId null) mantem o escopo por strategyId -- comportamento atual preservado', async () => {
    credentialsResolver.resolveCredentials.mockResolvedValue(makeCredentials({ portfolioId: null }));

    tradesRepository.find.mockResolvedValue([]);

    const strategyLegacy = makeStrategyRow({ id: 'strategy-legacy', portfolioId: null });
    await (service as any).syncStrategyPositions(strategyLegacy);

    const openTradesCall = tradesRepository.find.mock.calls.find((c: any) => c[0].where.status === 'OPEN');
    expect(openTradesCall[0].where).toEqual(
      expect.objectContaining({ strategyId: 'strategy-legacy' }),
    );
    expect(openTradesCall[0].where).not.toHaveProperty('portfolioId');
  });
});

describe('PositionSyncService (PLANO_FIX_PROTECAO_NAO_CRIADA -- limpeza de trades zumbi de estrategias inativas)', () => {
  let service: PositionSyncService;
  let tradesRepository: { save: jest.Mock; find: jest.Mock };
  let strategiesRepository: { find: jest.Mock };
  let tradesService: { findExecutions: jest.Mock; createExecution: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let exchangeFactory: { get: jest.Mock };
  let client: ReturnType<typeof makeExchangeClient>;

  beforeEach(async () => {
    jest.clearAllMocks();
    client = makeExchangeClient();
    client.getLastTradePrice.mockResolvedValue(0.083);
    exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    tradesRepository = { save: jest.fn(t => t), find: jest.fn().mockResolvedValue([]) };
    strategiesRepository = { find: jest.fn().mockResolvedValue([]) };
    tradesService = { findExecutions: jest.fn().mockResolvedValue([]), createExecution: jest.fn() };
    credentialsResolver = {
      resolveCredentials: jest.fn().mockResolvedValue({
        apiKey: 'enc-key', apiSecret: 'enc-secret', exchange: Exchange.BYBIT,
        isTestnet: false, isRealAccount: true, portfolioId: 'portfolio-shared', siteId: null, source: 'portfolio',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: getRepositoryToken(Strategy), useValue: strategiesRepository },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
  });

  it('trade OPEN de estrategia DESATIVADA sem posicao correspondente na corretora -> fecha como manual (zumbi do incidente DOGEUSDT)', async () => {
    const zombieTrade = {
      id: 'zombie-1',
      strategyId: 'strategy-inactive',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      status: 'OPEN',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      entryPrice: 0.085,
      quantity: 390,
      stopLossOrderId: null,
      takeProfitOrderId: null,
    };

    strategiesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.isActive === true) return [];
      if (where.id) return [{ id: 'strategy-inactive', name: 'Old Test', exchange: Exchange.BYBIT, apiKey: 'enc-key', apiSecret: 'enc-secret', portfolioId: 'portfolio-shared' }];
      return [];
    });
    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && !where.strategyId) return [zombieTrade];
      return [];
    });
    client.getPositions.mockResolvedValue([]);

    const result = await (service as any).closeZombieTradesFromInactiveStrategies();

    expect(result.closed).toBe(1);
    const savedClose = tradesRepository.save.mock.calls.find((c: any) => c[0].id === 'zombie-1');
    expect(savedClose[0].status).toBe('CLOSED');
  });

  it('trade de estrategia inativa AINDA TEM posicao real na corretora -> nao fecha (protege posicao legitima)', async () => {
    const stillOpenTrade = {
      id: 'still-open-1',
      strategyId: 'strategy-inactive',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      status: 'OPEN',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      entryPrice: 0.0848,
      quantity: 390,
    };

    strategiesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.isActive === true) return [];
      if (where.id) return [{ id: 'strategy-inactive', name: 'Old Test', exchange: Exchange.BYBIT, apiKey: 'enc-key', apiSecret: 'enc-secret', portfolioId: 'portfolio-shared' }];
      return [];
    });
    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && !where.strategyId) return [stillOpenTrade];
      return [];
    });
    client.getPositions.mockResolvedValue([
      { symbol: 'DOGEUSDT', side: 'SELL', size: '390', avgPrice: '0.0848', unrealizedPnl: '0', leverage: '50', markPrice: '0.0848' },
    ]);

    const result = await (service as any).closeZombieTradesFromInactiveStrategies();

    expect(result.closed).toBe(0);
    expect(tradesRepository.save).not.toHaveBeenCalled();
  });

  it('trade recem-criado (< 30s) de estrategia inativa -> nao fecha ainda, evita corrida com a proria criacao', async () => {
    const freshTrade = {
      id: 'fresh-1',
      strategyId: 'strategy-inactive',
      portfolioId: 'portfolio-shared',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      status: 'OPEN',
      timestamp: new Date(),
      entryPrice: 0.085,
      quantity: 390,
    };

    strategiesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.isActive === true) return [];
      if (where.id) return [{ id: 'strategy-inactive', name: 'Old Test', exchange: Exchange.BYBIT, apiKey: 'enc-key', apiSecret: 'enc-secret', portfolioId: 'portfolio-shared' }];
      return [];
    });
    tradesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.status === 'OPEN' && !where.strategyId) return [freshTrade];
      return [];
    });
    client.getPositions.mockResolvedValue([]);

    const result = await (service as any).closeZombieTradesFromInactiveStrategies();

    expect(result.closed).toBe(0);
  });

  it('nenhum trade OPEN pertence a estrategia inativa -> nao consulta a corretora, retorna cedo', async () => {
    strategiesRepository.find.mockImplementation(async ({ where }: any) => {
      if (where.isActive === true) return [{ id: 'strategy-active' }];
      return [];
    });
    tradesRepository.find.mockResolvedValue([
      { id: 't1', strategyId: 'strategy-active', status: 'OPEN', symbol: 'BTCUSDT', side: 'BUY', timestamp: new Date() },
    ]);

    const result = await (service as any).closeZombieTradesFromInactiveStrategies();

    expect(result.closed).toBe(0);
    expect(exchangeFactory.get).not.toHaveBeenCalled();
  });
});

describe('PositionSyncService.syncPositions (PLANO_DEFINITIVO_CORRETORAS FASE 3: rota de skip do WS usa exchange resolvida, nao o campo legado)', () => {
  let service: PositionSyncService;
  let strategiesRepository: { find: jest.Mock };
  let tradesRepository: { find: jest.Mock };
  let credentialsResolver: { resolve: jest.Mock; resolveCredentials: jest.Mock };
  let binanceWs: { getHealth: jest.Mock; isEnabled: jest.Mock };
  let exchangeFactory: { get: jest.Mock };

  const strategyRow = { id: 's1', name: 'X', legacyExchange: Exchange.BINANCE, portfolioId: 'portfolio-1' };

  beforeEach(async () => {
    jest.clearAllMocks();
    strategiesRepository = { find: jest.fn().mockResolvedValue([strategyRow]) };
    tradesRepository = { find: jest.fn().mockResolvedValue([]) };
    credentialsResolver = { resolve: jest.fn(), resolveCredentials: jest.fn().mockResolvedValue({ apiKey: null, apiSecret: null }) };
    binanceWs = { getHealth: jest.fn().mockReturnValue({ userDataStreams: [] }), isEnabled: jest.fn().mockReturnValue(false) };
    exchangeFactory = { get: jest.fn().mockReturnValue(makeExchangeClient()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: getRepositoryToken(Strategy), useValue: strategiesRepository },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: binanceWs },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
  });

  it('estrategia com campo legado=BINANCE mas portfolio resolve para OKX -> nao aplica a logica de skip do WS da Binance', async () => {
    credentialsResolver.resolve.mockResolvedValue({ ...strategyRow, exchange: Exchange.OKX, apiKey: 'k', apiSecret: 's' });

    await service.syncPositions();

    expect(binanceWs.getHealth).not.toHaveBeenCalled();
  });

  it('estrategia com campo legado != BINANCE mas portfolio resolve para BINANCE -> aplica a logica de skip do WS (evita IP ban)', async () => {
    credentialsResolver.resolve.mockResolvedValue({ ...strategyRow, legacyExchange: Exchange.BYBIT, exchange: Exchange.BINANCE, apiKey: 'k', apiSecret: 's' });
    binanceWs.isEnabled.mockReturnValue(true);

    await service.syncPositions();

    expect(binanceWs.getHealth).toHaveBeenCalled();
    expect(exchangeFactory.get).not.toHaveBeenCalled();
  });
});
