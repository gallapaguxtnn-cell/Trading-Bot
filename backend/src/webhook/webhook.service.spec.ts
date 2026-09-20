jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WebhookService } from './webhook.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { StrategiesService } from '../strategies/strategies.service';
import { TradesService } from '../trades/trades.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SignalLogService } from './signal-log.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { Exchange } from '../strategies/strategy.entity';
import { RateLimiterUtil } from '../utils/rate-limiter.util';

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

function makeExchangeClient() {
  return {
    getOpenOrders: jest.fn().mockResolvedValue([]),
    getOrderInfo: jest.fn(),
    getOrderHistory: jest.fn(),
    waitForPosition: jest.fn().mockResolvedValue(true),
    createStopLossOrder: jest.fn(),
    cancelOrder: jest.fn().mockResolvedValue(true),
    cancelAllOrders: jest.fn().mockResolvedValue(true),
    getPositionIdx: jest.fn().mockResolvedValue(0),
    createOrder: jest.fn(),
    getPositions: jest.fn().mockResolvedValue([]),
    getWalletBalance: jest.fn(),
    getCurrentPrice: jest.fn(),
    getLastTradePrice: jest.fn(),
    getSymbolRules: jest.fn(),
    setMarginMode: jest.fn(),
    setLeverage: jest.fn(),
  };
}

describe('WebhookService', () => {
  let service: WebhookService;
  let tradesService: { findById: jest.Mock; findOpenTrades: jest.Mock; updateTrade: jest.Mock };
  let strategiesService: { findOne: jest.Mock };
  let exchangeClient: ReturnType<typeof makeExchangeClient>;
  let exchangeFactory: { get: jest.Mock };

  beforeEach(async () => {
    tradesService = {
      findById: jest.fn(),
      findOpenTrades: jest.fn().mockResolvedValue([]),
      updateTrade: jest.fn(),
    };
    strategiesService = { findOne: jest.fn() };
    exchangeClient = makeExchangeClient();
    exchangeFactory = { get: jest.fn().mockReturnValue(exchangeClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calculateTakeProfitPrice mantem a formula (BUY soma %, SELL subtrai %) -- nenhuma FASE deste plano altera isso', () => {
    const calculateTakeProfitPrice = (service as any).calculateTakeProfitPrice.bind(service);

    expect(calculateTakeProfitPrice('BUY', 100, 2)).toBeCloseTo(102, 8);
    expect(calculateTakeProfitPrice('SELL', 100, 2)).toBeCloseTo(98, 8);
  });

  it('calculateStopLossPrice mantem a formula (BUY subtrai %, SELL soma %) -- nenhuma FASE deste plano altera isso', () => {
    const calculateStopLossPrice = (service as any).calculateStopLossPrice.bind(service);

    expect(calculateStopLossPrice('BUY', 100, 2)).toBeCloseTo(98, 8);
    expect(calculateStopLossPrice('SELL', 100, 2)).toBeCloseTo(102, 8);
  });

});

describe('WebhookService (FASE 2 -- fechar a janela de desprotecao)', () => {
  let service: WebhookService;
  let tradesService: { findById: jest.Mock; findOpenTrades: jest.Mock; updateTrade: jest.Mock };
  let strategiesService: { findOne: jest.Mock };
  let exchangeClient: ReturnType<typeof makeExchangeClient>;
  let exchangeFactory: { get: jest.Mock };

  function makeTrade(overrides: Record<string, any> = {}) {
    return {
      id: 'trade-1',
      strategyId: 'strategy-1',
      status: 'OPEN',
      type: 'LIMIT',
      exchangeOrderId: 'entry-1',
      symbol: 'SUIUSDT',
      side: 'SELL',
      quantity: 60,
      stopLossOrderId: 'sl-1',
      takeProfitOrderId: null,
      timestamp: new Date(),
      ...overrides,
    };
  }

  function makeStrategy(overrides: Record<string, any> = {}) {
    return {
      id: 'strategy-1',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      apiKey: 'fake-key',
      apiSecret: 'fake-secret',
      ...overrides,
    };
  }

  beforeEach(async () => {
    tradesService = {
      findById: jest.fn(),
      findOpenTrades: jest.fn().mockResolvedValue([]),
      updateTrade: jest.fn(),
    };
    strategiesService = { findOne: jest.fn() };
    exchangeClient = makeExchangeClient();
    exchangeFactory = { get: jest.fn().mockReturnValue(exchangeClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  it('retorna cedo (nada a fazer) quando SL e TP ja existem e as ordens de TP estao vivas na corretora', async () => {
    const trade = makeTrade({ takeProfitOrderId: '1:tp-a|2:tp-b' });
    tradesService.findById.mockResolvedValue(trade);
    strategiesService.findOne.mockResolvedValue(makeStrategy());
    exchangeClient.getOpenOrders.mockResolvedValue([{ orderId: 'tp-a' }, { orderId: 'tp-b' }]);
    const scheduleSpy = jest.spyOn(service as any, 'scheduleBybitProtectionOrders').mockImplementation(() => {});

    await service.resumeLimitProtection('trade-1');

    expect(scheduleSpy).not.toHaveBeenCalled();
    expect(tradesService.updateTrade).not.toHaveBeenCalled();
  });

  it('SL presente e TP ausente: verificacao independente aciona a criacao (nao retorna cedo so porque falta so um dos dois)', async () => {
    const trade = makeTrade({ stopLossOrderId: 'sl-1', takeProfitOrderId: null });
    tradesService.findById.mockResolvedValue(trade);
    strategiesService.findOne.mockResolvedValue(makeStrategy());
    const scheduleSpy = jest.spyOn(service as any, 'scheduleBybitProtectionOrders').mockImplementation(() => {});

    await service.resumeLimitProtection('trade-1');

    expect(scheduleSpy).toHaveBeenCalledWith('trade-1', 'SUIUSDT', 'SELL', expect.anything(), 'fake-key', 'fake-secret', 60);
  });

  it('takeProfitOrderId presente mas nenhuma ordem viva na Bybit: trata como TP ausente, limpa o campo e cria de novo', async () => {
    const trade = makeTrade({ takeProfitOrderId: '1:tp-a|2:tp-b' });
    tradesService.findById.mockResolvedValue(trade);
    strategiesService.findOne.mockResolvedValue(makeStrategy());
    exchangeClient.getOpenOrders.mockResolvedValue([]);
    const scheduleSpy = jest.spyOn(service as any, 'scheduleBybitProtectionOrders').mockImplementation(() => {});

    await service.resumeLimitProtection('trade-1');

    expect(tradesService.updateTrade).toHaveBeenCalledWith('trade-1', { takeProfitOrderId: null });
    expect(scheduleSpy).toHaveBeenCalled();
  });

  it('scanUnprotectedLimitTrades: emite alerta explicito quando um trade OPEN passa de 2 minutos sem TP e aciona o resume', async () => {
    const oldTimestamp = new Date(Date.now() - 3 * 60 * 1000);
    const trade = makeTrade({ takeProfitOrderId: null, timestamp: oldTimestamp });
    tradesService.findOpenTrades.mockResolvedValue([trade]);
    const resumeSpy = jest.spyOn(service, 'resumeLimitProtection').mockResolvedValue(undefined);
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    await (service as any).scanUnprotectedLimitTrades();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PROTECTION ALERT'));
    expect(resumeSpy).toHaveBeenCalledWith('trade-1');
  });

  it('scanUnprotectedLimitTrades: nao alerta nem aciona resume para trade totalmente protegido', async () => {
    const trade = makeTrade({ stopLossOrderId: 'sl-1', takeProfitOrderId: '1:tp-a' });
    tradesService.findOpenTrades.mockResolvedValue([trade]);
    const resumeSpy = jest.spyOn(service, 'resumeLimitProtection').mockResolvedValue(undefined);

    await (service as any).scanUnprotectedLimitTrades();

    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('scanUnprotectedLimitTrades: ignora trade recem-criado (menos de 30s) para nao competir com a criacao sincrona', async () => {
    const trade = makeTrade({ takeProfitOrderId: null, timestamp: new Date() });
    tradesService.findOpenTrades.mockResolvedValue([trade]);
    const resumeSpy = jest.spyOn(service, 'resumeLimitProtection').mockResolvedValue(undefined);

    await (service as any).scanUnprotectedLimitTrades();

    expect(resumeSpy).not.toHaveBeenCalled();
  });
});

describe('WebhookService (FASE 2 -- reposicionar SL/TP desalinhado no fill monitor Bybit)', () => {
  let service: WebhookService;
  let tradesService: { findById: jest.Mock; updateTrade: jest.Mock };
  let exchangeClient: ReturnType<typeof makeExchangeClient>;
  let exchangeFactory: { get: jest.Mock };
  let symbolRulesService: { getSymbolRules: jest.Mock };

  function makeTrade(overrides: Record<string, any> = {}) {
    return {
      id: 'trade-1',
      status: 'OPEN',
      exchangeOrderId: 'entry-1',
      entryPrice: 0.796,
      stopLossOrderId: 'sl-old',
      takeProfitOrderId: null,
      currentStopLoss: 0.8015,
      ...overrides,
    };
  }

  const strategy = { isTestnet: true, stopLossPercentage: 2, hedgeMode: false };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    tradesService = { findById: jest.fn(), updateTrade: jest.fn().mockResolvedValue(undefined) };
    exchangeClient = makeExchangeClient();
    exchangeFactory = { get: jest.fn().mockReturnValue(exchangeClient) };
    symbolRulesService = {
      getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: { findOne: jest.fn() } },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: symbolRulesService },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('SL desalinhado (caso real SUIUSDT: SL 0.8015 vs alvo 0.81192 sobre o fill 0.796) -> cria o novo antes de cancelar o antigo e grava protectionRepricedAt', async () => {
    tradesService.findById.mockResolvedValue(makeTrade());
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });
    exchangeClient.createStopLossOrder.mockResolvedValue({ orderId: 'sl-new' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).toHaveBeenCalledTimes(1);
    const [, , , , triggerPrice] = exchangeClient.createStopLossOrder.mock.calls[0];
    expect(triggerPrice).toBe('0.8119');

    const createOrderIndex = exchangeClient.createStopLossOrder.mock.invocationCallOrder[0];
    const cancelOrderIndex = exchangeClient.cancelOrder.mock.invocationCallOrder[0];
    expect(createOrderIndex).toBeLessThan(cancelOrderIndex);
    expect(exchangeClient.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'key', apiSecret: 'secret' }, mode: 'DEMO' }),
      'SUIUSDT',
      'sl-old',
    );

    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.stopLossOrderId).toBe('sl-new');
    expect(update.protectionRepricedAt).toBeInstanceOf(Date);
  });

  it('LIMIT preenchido: grava signalPrice (preco original do sinal, se ja gravado) e filledAt (hora real do fill) -- separa tempo pendente de tempo em posicao', async () => {
    tradesService.findById.mockResolvedValue(makeTrade({ signalPrice: 0.7858, stopLossOrderId: null, takeProfitOrderId: null }));
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', { ...strategy, stopLossPercentage: 0 }, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.signalPrice).toBe(0.7858);
    expect(update.filledAt).toBeInstanceOf(Date);
    expect(update.entryPrice).toBe(0.796);
  });

  it('LIMIT preenchido sem signalPrice previamente gravado: usa o proprio entryPrice do fill como signalPrice (fallback)', async () => {
    tradesService.findById.mockResolvedValue(makeTrade({ signalPrice: null, stopLossOrderId: null, takeProfitOrderId: null }));
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', { ...strategy, stopLossPercentage: 0 }, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.signalPrice).toBe(0.796);
  });

  it('SL alinhado com o alvo -> nao mexe (nao cria nem cancela nada)', async () => {
    tradesService.findById.mockResolvedValue(makeTrade({ currentStopLoss: 0.81192 }));
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).not.toHaveBeenCalled();
    expect(exchangeClient.cancelOrder).not.toHaveBeenCalled();
    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.stopLossOrderId).toBe('sl-old');
    expect(update.protectionRepricedAt).toBeUndefined();
  });

  it('reposicionamento falho (criacao do novo SL rejeitada) -> alerta critico, SL antigo preservado, nunca cancela o antigo', async () => {
    tradesService.findById.mockResolvedValue(makeTrade());
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });
    exchangeClient.createStopLossOrder.mockRejectedValue(new Error('Bybit rejected: risk limit'));
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.cancelOrder).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICO'));
    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.stopLossOrderId).toBe('sl-old');
    expect(update.protectionRepricedAt).toBeUndefined();
  });

  it('SL existente mas currentStopLoss nao gravado (trade antigo) -> nao reposiciona e loga erro, sem tocar no SL', async () => {
    tradesService.findById.mockResolvedValue(makeTrade({ currentStopLoss: null }));
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).not.toHaveBeenCalled();
    expect(exchangeClient.cancelOrder).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SL REPRICE'));
  });

  it('TP existente e entrada divergiu do sinal -> recria os TPs sobre o fill e cancela os antigos', async () => {
    tradesService.findById.mockResolvedValue(makeTrade({
      entryPrice: 0.7858,
      stopLossOrderId: null,
      takeProfitOrderId: '1:tp-old-a',
    }));
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });
    exchangeClient.createOrder.mockResolvedValue({ orderId: 'tp-new-a' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', {
      ...strategy,
      stopLossPercentage: 0,
      takeProfitPercentage1: 1,
      takeProfitQuantity1: 100,
      enableTakeProfit1: true,
      takeProfitPercentage2: null,
      enableTakeProfit2: false,
      takeProfitPercentage3: null,
      enableTakeProfit3: false,
    }, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createOrder).toHaveBeenCalled();
    expect(exchangeClient.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'key', apiSecret: 'secret' }, mode: 'DEMO' }),
      'SUIUSDT',
      'tp-old-a',
    );
    const update = tradesService.updateTrade.mock.calls[0][1];
    expect(update.takeProfitOrderId).toContain('1:tp-new-a');
    expect(update.takeProfitOrderId).not.toContain('tp-old-a');
    expect(update.protectionRepricedAt).toBeInstanceOf(Date);
  });
});

describe('WebhookService (FASE 3 -- nenhuma protecao antes do fill, sobrevive a reinicio)', () => {
  let service: WebhookService;
  let tradesService: { findById: jest.Mock; updateTrade: jest.Mock };
  let exchangeClient: ReturnType<typeof makeExchangeClient>;
  let exchangeFactory: { get: jest.Mock };

  function makePendingTrade(overrides: Record<string, any> = {}) {
    return {
      id: 'trade-1',
      status: 'OPEN',
      type: 'LIMIT',
      exchangeOrderId: 'entry-1',
      entryPrice: 0.7858,
      stopLossOrderId: null,
      takeProfitOrderId: null,
      currentStopLoss: null,
      ...overrides,
    };
  }

  const strategy = { isTestnet: true, stopLossPercentage: 2, hedgeMode: false, takeProfitPercentage1: null, takeProfitPercentage2: null, takeProfitPercentage3: null };

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    tradesService = { findById: jest.fn(), updateTrade: jest.fn().mockResolvedValue(undefined) };
    exchangeClient = makeExchangeClient();
    exchangeClient.createStopLossOrder.mockResolvedValue({ orderId: 'sl-new' });
    exchangeFactory = { get: jest.fn().mockReturnValue(exchangeClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: { findOne: jest.fn() } },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' }) } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ordem LIMIT ainda pendente (nao Filled): nenhuma chamada de criacao de SL/TP e feita', async () => {
    tradesService.findById.mockResolvedValue(makePendingTrade());
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'New' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).not.toHaveBeenCalled();
    expect(exchangeClient.createOrder).not.toHaveBeenCalled();
    expect(tradesService.updateTrade).not.toHaveBeenCalled();
  });

  it('ordem preenche apos ficar pendente: SL criado sobre o preco real do fill (nao o preco do sinal) so depois do Filled', async () => {
    tradesService.findById.mockResolvedValue(makePendingTrade());
    exchangeClient.getOrderInfo
      .mockResolvedValueOnce({ orderStatus: 'New' })
      .mockResolvedValueOnce({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });

    (service as any).scheduleBybitProtectionOrders('trade-1', 'SUIUSDT', 'SELL', strategy, 'key', 'secret', 50);
    await jest.advanceTimersByTimeAsync(10000);
    expect(exchangeClient.createStopLossOrder).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).toHaveBeenCalledTimes(1);
    const [, , , , triggerPrice] = exchangeClient.createStopLossOrder.mock.calls[0];
    expect(triggerPrice).toBe('0.8119');
    expect(triggerPrice).not.toBe('0.8015');
  });

  it('reinicio do processo com ordem pendente: resumeLimitProtection re-agenda o fill monitor, que so cria protecao apos o Filled', async () => {
    const strategiesService = { findOne: jest.fn().mockResolvedValue({ id: 'strategy-1', exchange: Exchange.BYBIT, isTestnet: true, apiKey: 'fake-key', apiSecret: 'fake-secret', stopLossPercentage: 2, takeProfitPercentage1: null, takeProfitPercentage2: null, takeProfitPercentage3: null }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: TradesService, useValue: tradesService },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' }) } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();
    const restartedService = module.get<WebhookService>(WebhookService);

    tradesService.findById.mockResolvedValue(makePendingTrade({ symbol: 'SUIUSDT', side: 'SELL', quantity: 50 }));
    exchangeClient.getOpenOrders.mockResolvedValue([]);
    exchangeClient.getOrderInfo.mockResolvedValue({ orderStatus: 'Filled', avgPrice: '0.796', cumExecQty: '50' });

    await restartedService.resumeLimitProtection('trade-1');
    await jest.advanceTimersByTimeAsync(10000);

    expect(exchangeClient.createStopLossOrder).toHaveBeenCalledTimes(1);
    const [, , , , triggerPrice] = exchangeClient.createStopLossOrder.mock.calls[0];
    expect(triggerPrice).toBe('0.8119');
  });
});

describe('WebhookService (PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT -- FASE 1: saldo pela corretora certa, nunca fallback fixo)', () => {
  let service: WebhookService;
  let exchangeFactory: { get: jest.Mock };
  let clientsByExchange: Record<string, ReturnType<typeof makeExchangeClient>>;

  function makeStrategy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'strategy-1',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      apiKey: 'key',
      apiSecret: 'secret',
      isRealAccount: false,
      portfolioId: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    RateLimiterUtil.getInstance().clearCache();

    clientsByExchange = {
      [Exchange.BYBIT]: makeExchangeClient(),
      [Exchange.BINANCE]: makeExchangeClient(),
      [Exchange.OKX]: makeExchangeClient(),
    };
    exchangeFactory = {
      get: jest.fn((exchange: Exchange) => {
        const client = clientsByExchange[exchange];
        if (!client) throw new Error(`Nenhum ExchangeClient registrado para ${exchange}`);
        return client;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: { findOne: jest.fn() } },
        { provide: TradesService, useValue: { findById: jest.fn(), findOpenTrades: jest.fn().mockResolvedValue([]), updateTrade: jest.fn() } },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  it('estrategia OKX -> busca o saldo na OKX (bug real: caia no fallback fixo para Bybit e recebia 401)', async () => {
    clientsByExchange[Exchange.OKX].getWalletBalance.mockResolvedValue(10);

    const balance = await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.OKX }));

    expect(balance).toBe(10);
    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.OKX);
    expect(clientsByExchange[Exchange.OKX].getWalletBalance).toHaveBeenCalledTimes(1);
    expect(clientsByExchange[Exchange.BYBIT].getWalletBalance).not.toHaveBeenCalled();
  });

  it('estrategia OKX com passphrase (via portfolio) -> passa a passphrase decriptada no AccountContext', async () => {
    clientsByExchange[Exchange.OKX].getWalletBalance.mockResolvedValue(10);
    const credentialsResolver = {
      resolveCredentials: jest.fn().mockResolvedValue({
        apiKey: 'okx-key', apiSecret: 'okx-secret', apiPassphrase: 'okx-pass',
        exchange: Exchange.OKX, isTestnet: false, isRealAccount: true, portfolioId: 'p1', siteId: null, source: 'portfolio',
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: { findOne: jest.fn() } },
        { provide: TradesService, useValue: { findById: jest.fn(), findOpenTrades: jest.fn().mockResolvedValue([]), updateTrade: jest.fn() } },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();
    const okxService = module.get<WebhookService>(WebhookService);

    await (okxService as any).getAccountBalance(makeStrategy({ exchange: Exchange.OKX, portfolioId: 'p1' }));

    expect(clientsByExchange[Exchange.OKX].getWalletBalance).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'okx-key', apiSecret: 'okx-secret', passphrase: 'okx-pass' } }),
    );
  });

  it('estrategia Bybit -> comportamento identico ao anterior, busca o saldo na Bybit', async () => {
    clientsByExchange[Exchange.BYBIT].getWalletBalance.mockResolvedValue(6.59);

    const balance = await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.BYBIT }));

    expect(balance).toBe(6.59);
    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.BYBIT);
    expect(clientsByExchange[Exchange.OKX].getWalletBalance).not.toHaveBeenCalled();
  });

  it('estrategia Binance -> migrado para client.getWalletBalance(), resultado identico ao calculo manual anterior (availableBalance com fallback para walletBalance)', async () => {
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    clientsByExchange[Exchange.BINANCE].getWalletBalance.mockResolvedValue(123.45);

    const balance = await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.BINANCE }));

    expect(balance).toBe(123.45);
    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.BINANCE);
  });

  it('corretora sem client registrado -> erro explicito, NUNCA cai para outra corretora', async () => {
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    delete clientsByExchange[Exchange.BINANCE];

    await expect(
      (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.BINANCE })),
    ).rejects.toThrow(/Nenhum ExchangeClient registrado/);

    expect(clientsByExchange[Exchange.BYBIT].getWalletBalance).not.toHaveBeenCalled();
    expect(clientsByExchange[Exchange.OKX].getWalletBalance).not.toHaveBeenCalled();
  });

  it('log [BALANCE] nomeia a corretora real (okx), nao "Bybit" fixo', async () => {
    clientsByExchange[Exchange.OKX].getWalletBalance.mockResolvedValue(10);
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.OKX }));

    const balanceLog = logSpy.mock.calls.map((c) => String(c[0])).find((msg) => msg.startsWith('[BALANCE]'));
    expect(balanceLog).toContain('okx');
    expect(balanceLog).not.toContain('Bybit');
  });

  it('valor cacheado (10s) e reaproveitado sem nova chamada a corretora', async () => {
    clientsByExchange[Exchange.OKX].getWalletBalance.mockResolvedValue(10);

    await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.OKX }));
    await (service as any).getAccountBalance(makeStrategy({ exchange: Exchange.OKX }));

    expect(clientsByExchange[Exchange.OKX].getWalletBalance).toHaveBeenCalledTimes(1);
  });

  it('getCurrentPrice(symbol, OKX, isTestnet) consulta o client da OKX -- antes caia direto no fallback fixo de preco da Binance', async () => {
    clientsByExchange[Exchange.OKX].getCurrentPrice.mockResolvedValue(0.08745);

    const price = await (service as any).getCurrentPrice('DOGEUSDT', Exchange.OKX, false);

    expect(price).toBe(0.08745);
    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.OKX);
    expect(clientsByExchange[Exchange.BINANCE].getCurrentPrice).not.toHaveBeenCalled();
  });

  it('getCurrentPrice continua funcionando para Bybit (comportamento preservado)', async () => {
    clientsByExchange[Exchange.BYBIT].getCurrentPrice.mockResolvedValue(0.796);

    const price = await (service as any).getCurrentPrice('SUIUSDT', Exchange.BYBIT, true);

    expect(price).toBe(0.796);
    expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.BYBIT);
  });

  it('getCurrentPrice: corretora sem client registrado devolve 0 e loga o erro, sem lancar', async () => {
    delete clientsByExchange[Exchange.BINANCE];

    const price = await (service as any).getCurrentPrice('BTCUSDT', Exchange.BINANCE, false);

    expect(price).toBe(0);
  });
});

describe('WebhookService (PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT -- FASE 3: 200 em vez de 500, idempotencia por sinal)', () => {
  let service: WebhookService;
  let strategiesService: { findOne: jest.Mock };
  let signalLog: { record: jest.Mock; decide: jest.Mock; decideFromResult: jest.Mock };
  let exchangeFactory: { get: jest.Mock };

  function makeSignal(overrides: Record<string, unknown> = {}) {
    return {
      strategyId: 'strategy-1',
      symbol: 'DOGEUSDT',
      action: 'buy',
      price: 0.08745,
      ...overrides,
    } as any;
  }

  beforeEach(async () => {
    strategiesService = { findOne: jest.fn() };
    signalLog = {
      record: jest.fn().mockReturnValue('signal-log-1'),
      decide: jest.fn(),
      decideFromResult: jest.fn(),
    };
    exchangeFactory = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: TradesService, useValue: { findById: jest.fn(), findOpenTrades: jest.fn().mockResolvedValue([]), updateTrade: jest.fn(), countClosedTrades: jest.fn().mockResolvedValue(0) } },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: signalLog },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: passthroughCredentialsResolver() },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  it('falha de pre-processamento (erro ao buscar a estrategia) nunca lanca excecao -- devolve accepted:false com o motivo', async () => {
    strategiesService.findOne.mockRejectedValue(new Error('DB connection lost'));

    const result = await service.processSignal(makeSignal());

    expect(result).toEqual(expect.objectContaining({ status: 'error', accepted: false, reason: 'DB connection lost' }));
    expect(signalLog.decide).toHaveBeenCalledWith('signal-log-1', 'error', 'DB connection lost');
  });

  it('qualquer falha dentro do processamento do sinal (ex.: saldo indisponivel, bug real do plano) vira accepted:false, nunca lanca', async () => {
    jest.spyOn(service as any, '_processSignalInternal').mockRejectedValue(
      new Error('Nenhum ExchangeClient registrado para okx'),
    );

    await expect(service.processSignal(makeSignal())).resolves.toEqual(
      expect.objectContaining({ status: 'error', accepted: false, reason: 'Nenhum ExchangeClient registrado para okx' }),
    );
  });

  it('3 sinais identicos em sequencia (retry do TradingView) -> UMA execucao, duas ignoradas por idempotencia', async () => {
    strategiesService.findOne.mockResolvedValue({
      id: 'strategy-1', name: 'FF1 TEST', exchange: Exchange.BYBIT, isActive: false, isTestnet: true,
      apiKey: 'key', apiSecret: 'secret',
    });

    const signal = makeSignal();
    const r1 = await service.processSignal(signal);
    const r2 = await service.processSignal(signal);
    const r3 = await service.processSignal(signal);

    expect(strategiesService.findOne).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(expect.objectContaining({ status: 'skipped', message: 'Strategy is paused' }));
    expect(r2).toEqual(expect.objectContaining({ status: 'ignored', accepted: false }));
    expect(r3).toEqual(expect.objectContaining({ status: 'ignored', accepted: false }));
    expect(signalLog.decide).toHaveBeenCalledWith(
      'signal-log-1', 'skipped_duplicate_signal', expect.stringContaining('Duplicate signal'),
    );
  });

  it('sinais com barTime diferente NAO sao tratados como duplicata (candles diferentes)', async () => {
    strategiesService.findOne.mockResolvedValue({
      id: 'strategy-1', name: 'FF1 TEST', exchange: Exchange.BYBIT, isActive: false, isTestnet: true,
      apiKey: 'key', apiSecret: 'secret',
    });

    await service.processSignal(makeSignal({ barTime: '2026-09-19T19:43:00Z' }));
    await service.processSignal(makeSignal({ barTime: '2026-09-19T19:44:00Z' }));

    expect(strategiesService.findOne).toHaveBeenCalledTimes(2);
  });

  it('apos a janela de idempotencia (60s), o mesmo sinal e processado de novo', async () => {
    jest.useFakeTimers();
    strategiesService.findOne.mockResolvedValue({
      id: 'strategy-1', name: 'FF1 TEST', exchange: Exchange.BYBIT, isActive: false, isTestnet: true,
      apiKey: 'key', apiSecret: 'secret',
    });

    const signal = makeSignal();
    await service.processSignal(signal);
    jest.advanceTimersByTime(61_000);
    await service.processSignal(signal);

    expect(strategiesService.findOne).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
