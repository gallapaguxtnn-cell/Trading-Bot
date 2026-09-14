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
  const credentialsResolver = overrides.credentialsResolver ?? { resolveCredentials: jest.fn() };
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
});
