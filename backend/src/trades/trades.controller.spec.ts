jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { TradesController } from './trades.controller';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';

function makeController(exchangeFactory: any = {}) {
  const tradesService = { findOpenTrades: jest.fn(), updateTrade: jest.fn(), createExecution: jest.fn() } as any;
  const positionSyncService = {} as any;
  const strategiesService = { findOne: jest.fn() } as any;
  const credentialsResolver = { resolveCredentials: jest.fn() };
  const controller = new TradesController(
    tradesService,
    positionSyncService,
    strategiesService,
    exchangeFactory,
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

describe('TradesController (FASE 2 PLANO_INTEGRACAO_OKX -- closeTradeOnExchange via ExchangeClientFactory)', () => {
  function makeClient() {
    return {
      cancelAllOrders: jest.fn().mockResolvedValue(true),
      getPositions: jest.fn().mockResolvedValue([]),
      getCurrentPrice: jest.fn().mockResolvedValue(50000),
      createOrder: jest.fn().mockResolvedValue({ orderId: 'o1' }),
      getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' }),
    };
  }

  it('fecha posicao em hedge mode: cancelAllOrders e createOrder recebem positionSide = lado original do trade, mesmo com o closeSide invertido', async () => {
    const client = makeClient();
    client.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'BUY', size: '2' }]);
    const exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    const { controller } = makeController(exchangeFactory);

    const trade = { id: 't1', symbol: 'BTCUSDT', side: 'BUY', entryPrice: 40000, quantity: 2, pnl: null };
    const strategy = { exchange: Exchange.BYBIT, isTestnet: false, hedgeMode: true, siteId: null };

    const result = await (controller as any).closeTradeOnExchange(trade, strategy, Exchange.BYBIT, 'key', 'secret');

    expect(result.success).toBe(true);
    expect(client.cancelAllOrders).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT', 'BUY');
    expect(client.createOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'MARKET',
      reduceOnly: true,
      hedgeMode: true,
      positionSide: 'BUY',
    }));
  });

  it('fecha posicao em one-way mode: cancelAllOrders nao recebe positionSide (cancela tudo do simbolo)', async () => {
    const client = makeClient();
    client.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'SELL', size: '1' }]);
    const exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    const { controller } = makeController(exchangeFactory);

    const trade = { id: 't2', symbol: 'BTCUSDT', side: 'SELL', entryPrice: 40000, quantity: 1, pnl: null };
    const strategy = { exchange: Exchange.BINANCE, isTestnet: true, hedgeMode: false, siteId: null };

    await (controller as any).closeTradeOnExchange(trade, strategy, Exchange.BINANCE, 'key', 'secret');

    expect(client.cancelAllOrders).toHaveBeenCalledWith(expect.anything(), 'BTCUSDT', undefined);
  });

  it('posicao ja fechada na corretora (size 0): marca CLOSED com alreadyClosed=true e nao chama createOrder', async () => {
    const client = makeClient();
    client.getPositions.mockResolvedValue([]);
    const exchangeFactory = { get: jest.fn().mockReturnValue(client) };
    const { controller, tradesService } = makeController(exchangeFactory);

    const trade = { id: 't3', symbol: 'BTCUSDT', side: 'BUY', entryPrice: 40000, quantity: 1, pnl: 5 };
    const strategy = { exchange: Exchange.BYBIT, isTestnet: false, hedgeMode: false, siteId: null };

    const result = await (controller as any).closeTradeOnExchange(trade, strategy, Exchange.BYBIT, 'key', 'secret');

    expect(result).toEqual({ success: false, alreadyClosed: true, pnl: 5 });
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(tradesService.updateTrade).toHaveBeenCalledWith('t3', expect.objectContaining({ status: 'CLOSED' }));
  });

  it('getPositionSize: Bybit casa qualquer posicao com size>0 (comportamento original); Binance casa pelo side do trade', async () => {
    const clientBybit = makeClient();
    clientBybit.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'SELL', size: '3' }]);
    const { controller } = makeController();

    const sizeBybit = await (controller as any).getPositionSize(Exchange.BYBIT, clientBybit, {}, 'BTCUSDT', 'BUY');
    expect(sizeBybit).toBe(3);

    const clientBinance = makeClient();
    clientBinance.getPositions.mockResolvedValue([
      { symbol: 'BTCUSDT', side: 'SELL', size: '3' },
      { symbol: 'BTCUSDT', side: 'BUY', size: '1.5' },
    ]);
    const sizeBinance = await (controller as any).getPositionSize(Exchange.BINANCE, clientBinance, {}, 'BTCUSDT', 'BUY');
    expect(sizeBinance).toBe(1.5);
  });
});
