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
    symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

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
    } as unknown as Strategy;

    await service.checkBreakAgain(trade, undefined, strategy, 'key', 'secret');

    expect(client.createStopLossOrder).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: 'key', apiSecret: 'secret' }, mode: 'REAL' }),
      'BTCUSDT', 'BUY', '250', expect.any(String), false,
    );
  });

  it('aborta a atualizacao do SL (nao envia a ordem) quando a quantidade normalizada arredonda para 0', async () => {
    symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

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
    } as unknown as Strategy;

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
    } as unknown as Strategy;

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
