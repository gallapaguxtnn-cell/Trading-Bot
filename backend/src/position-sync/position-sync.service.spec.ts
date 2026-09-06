jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionSyncService } from './position-sync.service';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { Trade } from '../strategies/trade.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { TradesService } from '../trades/trades.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { EncryptionUtil } from '../utils/encryption.util';

describe('PositionSyncService (FASE 3 -- arredondamento via SymbolRulesService)', () => {
  let service: PositionSyncService;
  let tradesRepository: { save: jest.Mock };
  let symbolRulesService: { getSymbolRules: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    tradesRepository = { save: jest.fn() };
    symbolRulesService = { getSymbolRules: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: {} },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SymbolRulesService, useValue: symbolRulesService },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<PositionSyncService>(PositionSyncService);
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { algoId: 999 } });
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

    const postBody = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(postBody);
    expect(params.get('quantity')).toBe('250');
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

    expect(BinanceRequestUtil.post).not.toHaveBeenCalled();
  });
});

describe('PositionSyncService (FASE 2 -- CredentialsResolver)', () => {
  let service: PositionSyncService;
  let credentialsResolver: { resolveCredentials: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionSyncService,
        { provide: getRepositoryToken(Trade), useValue: { save: jest.fn(), find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: {} },
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
      source: 'portfolio',
    });

    const fetchBybitSpy = jest.spyOn(service as any, 'fetchBybitPositions').mockResolvedValue([]);
    const fetchBinanceSpy = jest.spyOn(service as any, 'fetchBinancePositions').mockResolvedValue([]);

    await (service as any).syncStrategyPositions(strategy);

    expect(fetchBybitSpy).toHaveBeenCalled();
    expect(fetchBinanceSpy).not.toHaveBeenCalled();
    const [apiKeyArg, apiSecretArg, isTestnetArg] = fetchBybitSpy.mock.calls[0];
    expect(apiKeyArg).toBe('portfolio-key');
    expect(apiSecretArg).toBe('portfolio-secret');
    expect(isTestnetArg).toBe(false);
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
      source: 'strategy',
    });

    const fetchBybitSpy = jest.spyOn(service as any, 'fetchBybitPositions').mockResolvedValue([]);

    await (service as any).syncStrategyPositions(strategy);

    expect(fetchBybitSpy).toHaveBeenCalled();
    const [apiKeyArg] = fetchBybitSpy.mock.calls[0];
    expect(apiKeyArg).toBe('legacy-key');
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
      source: 'strategy',
    });

    const fetchBybitSpy = jest.spyOn(service as any, 'fetchBybitPositions').mockResolvedValue([]);

    const result = await (service as any).syncStrategyPositions(strategy);

    expect(fetchBybitSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, closed: 0, imported: 0, consolidated: 0 });
  });
});
