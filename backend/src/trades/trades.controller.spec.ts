jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { TradesController } from './trades.controller';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';

function makeController() {
  const tradesService = { findOpenTrades: jest.fn(), updateTrade: jest.fn() } as any;
  const positionSyncService = {} as any;
  const strategiesService = { findOne: jest.fn() } as any;
  const bybitClient = {} as any;
  const credentialsResolver = { resolveCredentials: jest.fn() };
  const controller = new TradesController(
    tradesService,
    positionSyncService,
    strategiesService,
    bybitClient,
    credentialsResolver as any,
  );
  return { controller, tradesService, strategiesService, credentialsResolver };
}

describe('TradesController (FASE 2 -- CredentialsResolver)', () => {
  it('closePosition com portfolio: fecha na corretora usando exchange/credenciais do portfolio (nao os campos legados)', async () => {
    const { controller, tradesService, strategiesService, credentialsResolver } = makeController();
    const trade = { id: 'trade-1', strategyId: 's1', symbol: 'BTCUSDT', side: 'BUY' };
    tradesService.findOpenTrades.mockResolvedValue([trade]);
    strategiesService.findOne.mockResolvedValue({
      id: 's1',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      apiKey: 'legacy-enc-key',
      apiSecret: 'legacy-enc-secret',
      portfolioId: 'p1',
    });
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: await EncryptionUtil.encrypt('portfolio-key'),
      apiSecret: await EncryptionUtil.encrypt('portfolio-secret'),
      exchange: Exchange.BYBIT,
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'p1',
      source: 'portfolio',
    });
    const closeSpy = jest
      .spyOn(controller as any, 'closeTradeOnExchange')
      .mockResolvedValue({ success: true, pnl: 1 });

    await controller.closePosition('trade-1');

    expect(closeSpy).toHaveBeenCalled();
    const [, resolvedStrategyArg, exchangeArg, apiKeyArg, apiSecretArg] = closeSpy.mock.calls[0];
    expect(exchangeArg).toBe(Exchange.BYBIT);
    expect(apiKeyArg).toBe('portfolio-key');
    expect(apiSecretArg).toBe('portfolio-secret');
    expect((resolvedStrategyArg as { isTestnet: boolean }).isTestnet).toBe(false);
  });

  it('closePosition sem portfolio: usa exchange/credenciais legadas da estrategia (comportamento atual preservado)', async () => {
    const { controller, tradesService, strategiesService, credentialsResolver } = makeController();
    const trade = { id: 'trade-1', strategyId: 's1', symbol: 'BTCUSDT', side: 'BUY' };
    tradesService.findOpenTrades.mockResolvedValue([trade]);
    const encryptedKey = await EncryptionUtil.encrypt('legacy-key');
    const encryptedSecret = await EncryptionUtil.encrypt('legacy-secret');
    strategiesService.findOne.mockResolvedValue({
      id: 's1',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      portfolioId: null,
    });
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: encryptedKey,
      apiSecret: encryptedSecret,
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      source: 'strategy',
    });
    const closeSpy = jest
      .spyOn(controller as any, 'closeTradeOnExchange')
      .mockResolvedValue({ success: true, pnl: 1 });

    await controller.closePosition('trade-1');

    const [, , exchangeArg, apiKeyArg] = closeSpy.mock.calls[0];
    expect(exchangeArg).toBe(Exchange.BYBIT);
    expect(apiKeyArg).toBe('legacy-key');
  });
});
