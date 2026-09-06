jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WebhookService } from './webhook.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { StrategiesService } from '../strategies/strategies.service';
import { TradesService } from '../trades/trades.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SignalLogService } from './signal-log.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { Exchange } from '../strategies/strategy.entity';

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

describe('WebhookService', () => {
  let service: WebhookService;
  let tradesService: { findById: jest.Mock; findOpenTrades: jest.Mock; updateTrade: jest.Mock };
  let strategiesService: { findOne: jest.Mock };
  let bybitClient: { getOpenOrders: jest.Mock };

  beforeEach(async () => {
    tradesService = {
      findById: jest.fn(),
      findOpenTrades: jest.fn().mockResolvedValue([]),
      updateTrade: jest.fn(),
    };
    strategiesService = { findOne: jest.fn() };
    bybitClient = { getOpenOrders: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
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
  let bybitClient: { getOpenOrders: jest.Mock };

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
    bybitClient = { getOpenOrders: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
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
    bybitClient.getOpenOrders.mockResolvedValue([{ orderId: 'tp-a' }, { orderId: 'tp-b' }]);
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
    bybitClient.getOpenOrders.mockResolvedValue([]);
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
