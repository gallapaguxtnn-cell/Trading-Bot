import { StrategiesService } from './strategies.service';
import { Exchange } from './strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';

function makeClient() {
  return {
    cancelOrder: jest.fn().mockResolvedValue(true),
    getOpenOrders: jest.fn().mockResolvedValue([]),
    getPositions: jest.fn().mockResolvedValue([]),
  };
}

function makeService(overrides: { client?: any; strategiesRepository?: any; tradesRepository?: any; credentialsResolver?: any } = {}) {
  const client = overrides.client ?? makeClient();
  const exchangeFactory = { get: jest.fn().mockReturnValue(client) };
  const strategiesRepository = overrides.strategiesRepository ?? { findOneBy: jest.fn(), find: jest.fn() };
  const tradesRepository = overrides.tradesRepository ?? { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
  const credentialsResolver = overrides.credentialsResolver ?? { resolveCredentials: jest.fn(), resolve: jest.fn(), invalidate: jest.fn() };
  const portfoliosService = { findSummariesByIds: jest.fn().mockResolvedValue(new Map()) };

  const service = new StrategiesService(
    strategiesRepository as any,
    tradesRepository as any,
    exchangeFactory as any,
    credentialsResolver as any,
    portfoliosService as any,
  );
  return { service, client, exchangeFactory, strategiesRepository, tradesRepository, credentialsResolver };
}

describe('StrategiesService (PLANO_INTEGRACAO_OKX FASE 2 -- ExchangeClientFactory)', () => {
  it('cancelPendingLimitOrders: cancela via client.cancelOrder e marca ERROR, sem depender de qual corretora', async () => {
    const trade = { id: 't1', symbol: 'BTCUSDT', exchangeOrderId: 'o1' };
    const { service, client, tradesRepository, credentialsResolver } = makeService({
      strategiesRepository: { findOneBy: jest.fn().mockResolvedValue({ id: 's1', exchange: Exchange.BYBIT, isTestnet: true, apiKey: 'k', apiSecret: 's', portfolioId: null }) },
      tradesRepository: { find: jest.fn().mockResolvedValue([trade]), update: jest.fn() },
    });
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'k', apiSecret: 's', exchange: Exchange.BYBIT, isTestnet: true, isRealAccount: false, portfolioId: null, siteId: null, source: 'strategy',
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's1', exchange: Exchange.BYBIT, isTestnet: true, apiKey: 'k', apiSecret: 's', portfolioId: null } as any);

    await (service as any).cancelPendingLimitOrders('s1');

    expect(client.cancelOrder).toHaveBeenCalledWith(expect.objectContaining({ mode: 'DEMO' }), 'BTCUSDT', 'o1');
    expect(tradesRepository.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'ERROR' }));
  });

  it('getOpenOrders: posicao Bybit sai como Buy/Sell no output (preserva o formato historico); Binance sai como LONG/SHORT', async () => {
    const clientBybit = makeClient();
    clientBybit.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'BUY', size: '1', avgPrice: '100', unrealizedPnl: '1', leverage: '10' }]);
    const credentialsResolverBybit = { resolveCredentials: jest.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's', exchange: Exchange.BYBIT, isTestnet: true, isRealAccount: false, portfolioId: null, siteId: null, source: 'strategy' }) };
    const { service: serviceBybit } = makeService({ client: clientBybit, strategiesRepository: { findOneBy: jest.fn() }, credentialsResolver: credentialsResolverBybit });
    jest.spyOn(serviceBybit, 'findOne').mockResolvedValue({ id: 's1', exchange: Exchange.BYBIT, isTestnet: true, apiKey: 'k', apiSecret: 's', name: 'X', isRealAccount: false } as any);

    const resultBybit = await serviceBybit.getOpenOrders('s1');
    expect(resultBybit.openPositions[0].side).toBe('Buy');

    const clientBinance = makeClient();
    clientBinance.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'SELL', size: '1', avgPrice: '100', unrealizedPnl: '1', leverage: '10' }]);
    const credentialsResolverBinance = { resolveCredentials: jest.fn().mockResolvedValue({ apiKey: 'k', apiSecret: 's', exchange: Exchange.BINANCE, isTestnet: true, isRealAccount: false, portfolioId: null, siteId: null, source: 'strategy' }) };
    const { service: serviceBinance } = makeService({ client: clientBinance, strategiesRepository: { findOneBy: jest.fn() }, credentialsResolver: credentialsResolverBinance });
    jest.spyOn(serviceBinance, 'findOne').mockResolvedValue({ id: 's2', exchange: Exchange.BINANCE, isTestnet: true, apiKey: 'k', apiSecret: 's', name: 'Y', isRealAccount: false } as any);

    const resultBinance = await serviceBinance.getOpenOrders('s2');
    expect(resultBinance.openPositions[0].side).toBe('SHORT');
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 2: update() invalida o cache do CredentialsResolver para a estrategia alterada', async () => {
    const strategiesRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 's1' }), update: jest.fn() };
    const { service, credentialsResolver } = makeService({ strategiesRepository });

    await service.update('s1', { stopLossPercentage: 3 });

    expect(strategiesRepository.update).toHaveBeenCalledWith('s1', { stopLossPercentage: 3 });
    expect(credentialsResolver.invalidate).toHaveBeenCalledWith('s1');
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 2: updateCredentials() invalida o cache do CredentialsResolver para a estrategia alterada', async () => {
    const strategiesRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 's1', name: 'FF1' }), update: jest.fn() };
    const { service, credentialsResolver } = makeService({ strategiesRepository });

    await service.updateCredentials('s1', 'new-key', 'new-secret');

    expect(credentialsResolver.invalidate).toHaveBeenCalledWith('s1');
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 3: updateCredentials() grava nos campos legados renomeados (legacyApiKey/legacyApiSecret)', async () => {
    const strategiesRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 's1', name: 'FF1' }), update: jest.fn() };
    const { service, strategiesRepository: repo } = makeService({ strategiesRepository });

    await service.updateCredentials('s1', 'new-key', 'new-secret');

    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({
      legacyApiKey: expect.any(String),
      legacyApiSecret: expect.any(String),
    }));
    const [, payload] = repo.update.mock.calls[0];
    expect(await EncryptionUtil.decrypt(payload.legacyApiKey)).toBe('new-key');
    expect(await EncryptionUtil.decrypt(payload.legacyApiSecret)).toBe('new-secret');
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 3: create() mapeia exchange/apiKey/apiSecret/isTestnet/isRealAccount do wire para os campos legados', async () => {
    const strategiesRepository = {
      findOneBy: jest.fn(),
      create: jest.fn((s) => s),
      save: jest.fn((s) => Promise.resolve({ ...s, id: 'new-id' })),
    };
    const { service } = makeService({ strategiesRepository });

    await service.create({
      name: 'FF2',
      asset: 'ETH',
      exchange: Exchange.OKX,
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      isTestnet: true,
      isRealAccount: false,
    } as any);

    expect(strategiesRepository.create).toHaveBeenCalledTimes(1);
    const [entityArg] = strategiesRepository.create.mock.calls[0];
    expect(entityArg.legacyExchange).toBe(Exchange.OKX);
    expect(entityArg.legacyIsTestnet).toBe(true);
    expect(entityArg.legacyIsRealAccount).toBe(false);
    expect(entityArg.exchange).toBeUndefined();
    expect(entityArg.apiKey).toBeUndefined();
    expect(entityArg.apiSecret).toBeUndefined();
    expect(await EncryptionUtil.decrypt(entityArg.legacyApiKey)).toBe('plain-key');
    expect(await EncryptionUtil.decrypt(entityArg.legacyApiSecret)).toBe('plain-secret');
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 3: update() mapeia campos wire para os campos legados sem tocar em campos nao relacionados', async () => {
    const strategiesRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 's1' }), update: jest.fn() };
    const { service } = makeService({ strategiesRepository });

    await service.update('s1', { exchange: Exchange.BYBIT, isTestnet: true, stopLossPercentage: 5 } as any);

    expect(strategiesRepository.update).toHaveBeenCalledWith('s1', {
      stopLossPercentage: 5,
      legacyExchange: Exchange.BYBIT,
      legacyIsTestnet: true,
    });
  });

  it('PLANO_DEFINITIVO_CORRETORAS FASE 3: findAll() expoe exchange/isTestnet/isRealAccount (wire) em vez dos campos legados', async () => {
    const strategiesRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 's1', portfolioId: null, legacyExchange: Exchange.OKX, legacyIsTestnet: true, legacyIsRealAccount: false },
      ]),
    };
    const { service } = makeService({ strategiesRepository });

    const [result] = await service.findAll();

    expect(result.exchange).toBe(Exchange.OKX);
    expect(result.isTestnet).toBe(true);
    expect(result.isRealAccount).toBe(false);
    expect((result as any).legacyExchange).toBeUndefined();
    expect((result as any).legacyIsTestnet).toBeUndefined();
    expect((result as any).legacyIsRealAccount).toBeUndefined();
  });
});
