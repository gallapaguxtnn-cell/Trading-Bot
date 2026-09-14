import { BybitExchangeClient } from './bybit-exchange.client';
import { BybitClientService } from './bybit-client.service';
import { AccountContext } from './exchange-client.interface';

function makeCtx(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    credentials: { apiKey: 'key', apiSecret: 'secret' },
    mode: 'REAL',
    region: null,
    ...overrides,
  };
}

describe('BybitExchangeClient (adapter -- traduz AccountContext para o BybitClientService existente)', () => {
  let bybit: jest.Mocked<Partial<BybitClientService>>;
  let client: BybitExchangeClient;

  beforeEach(() => {
    bybit = {
      createOrder: jest.fn().mockResolvedValue({ orderId: 'o1', orderLinkId: 'l1' }),
      cancelOrder: jest.fn().mockResolvedValue(true),
      cancelAllOrders: jest.fn().mockResolvedValue(true),
      getOpenOrders: jest.fn().mockResolvedValue([]),
      getOrderInfo: jest.fn().mockResolvedValue(null),
      getOrderHistory: jest.fn().mockResolvedValue(null),
      createStopLossOrder: jest.fn().mockResolvedValue({ orderId: 'sl1', orderLinkId: 'l2' }),
      setTradingStop: jest.fn().mockResolvedValue(true),
      clearTradingStop: jest.fn().mockResolvedValue(true),
      getPositions: jest.fn().mockResolvedValue([]),
      detectPositionMode: jest.fn().mockResolvedValue('ONE_WAY'),
      getPositionIdx: jest.fn().mockResolvedValue(0),
      waitForPosition: jest.fn().mockResolvedValue(true),
      setLeverage: jest.fn().mockResolvedValue(undefined),
      setMarginMode: jest.fn().mockResolvedValue(undefined),
      getWalletBalance: jest.fn().mockResolvedValue(1000),
      getCurrentPrice: jest.fn().mockResolvedValue(50000),
      getLastTradePrice: jest.fn().mockResolvedValue(50001),
      getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' }),
      getServerTime: jest.fn().mockResolvedValue(123456),
    };
    client = new BybitExchangeClient(bybit as BybitClientService);
  });

  it('mode REAL -> isTestnet false; mode DEMO -> isTestnet true (createOrder)', async () => {
    await client.createOrder(makeCtx({ mode: 'REAL' }), { symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', qty: '1' });
    expect(bybit.createOrder).toHaveBeenCalledWith('key', 'secret', false, expect.objectContaining({ side: 'Buy', orderType: 'Market' }), null);

    await client.createOrder(makeCtx({ mode: 'DEMO' }), { symbol: 'BTCUSDT', side: 'SELL', orderType: 'LIMIT', qty: '1', price: '100' });
    expect(bybit.createOrder).toHaveBeenCalledWith('key', 'secret', true, expect.objectContaining({ side: 'Sell', orderType: 'Limit', price: '100' }), null);
  });

  it('region e repassado como siteId em toda chamada autenticada', async () => {
    const ctx = makeCtx({ region: 'BRA_BTL' });
    await client.getPositions(ctx, 'BTCUSDT');
    expect(bybit.getPositions).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'BRA_BTL');

    await client.cancelOrder(ctx, 'BTCUSDT', 'o1');
    expect(bybit.cancelOrder).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'o1', 'BRA_BTL');
  });

  it('getPositions traduz side Buy/Sell/None do Bybit para o formato neutro', async () => {
    (bybit.getPositions as jest.Mock).mockResolvedValue([
      { symbol: 'BTCUSDT', side: 'Buy', size: '1', avgPrice: '50000', unrealisedPnl: '10', leverage: '10', markPrice: '50010' },
      { symbol: 'ETHUSDT', side: 'Sell', size: '2', avgPrice: '3000', unrealisedPnl: '-5', leverage: '5', markPrice: '2995' },
      { symbol: 'SOLUSDT', side: 'None', size: '0', avgPrice: '0', unrealisedPnl: '0', leverage: '1', markPrice: '100' },
    ]);

    const positions = await client.getPositions(makeCtx());

    expect(positions).toEqual([
      expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY' }),
      expect.objectContaining({ symbol: 'ETHUSDT', side: 'SELL' }),
      expect.objectContaining({ symbol: 'SOLUSDT', side: 'NONE' }),
    ]);
  });

  it('createStopLossOrder, setTradingStop, clearTradingStop, getPositionIdx e waitForPosition traduzem side neutro para Buy/Sell', async () => {
    const ctx = makeCtx();
    await client.createStopLossOrder(ctx, 'BTCUSDT', 'SELL', '1', '49000', true);
    expect(bybit.createStopLossOrder).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'Sell', '1', '49000', true, null);

    await client.setTradingStop(ctx, 'BTCUSDT', 'BUY', '49000', '51000', false);
    expect(bybit.setTradingStop).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'Buy', '49000', '51000', false, null);

    await client.clearTradingStop(ctx, 'BTCUSDT', 'SELL', true);
    expect(bybit.clearTradingStop).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'Sell', true, null);

    await client.getPositionIdx(ctx, 'BTCUSDT', 'BUY', true);
    expect(bybit.getPositionIdx).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'Buy', true, null);

    await client.waitForPosition(ctx, 'BTCUSDT', 'SELL', 5, 200, false);
    expect(bybit.waitForPosition).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'Sell', 5, 200, false, null);
  });

  it('getSymbolRules e getCurrentPrice e getServerTime nao levam credenciais (endpoints publicos), so isTestnet', async () => {
    await client.getSymbolRules(makeCtx({ mode: 'DEMO' }), 'BTCUSDT');
    expect(bybit.getSymbolRules).toHaveBeenCalledWith(true, 'BTCUSDT');

    await client.getCurrentPrice(makeCtx({ mode: 'REAL' }), 'BTCUSDT');
    expect(bybit.getCurrentPrice).toHaveBeenCalledWith(false, 'BTCUSDT');

    await client.getServerTime(makeCtx({ mode: 'DEMO' }));
    expect(bybit.getServerTime).toHaveBeenCalledWith(true);
  });

  it('setLeverage, setMarginMode, getWalletBalance, getLastTradePrice, getOpenOrders, getOrderInfo, getOrderHistory, cancelAllOrders, detectPositionMode repassam credenciais/isTestnet/siteId corretamente', async () => {
    const ctx = makeCtx({ region: 'ARG_BTL' });

    await client.setLeverage(ctx, 'BTCUSDT', 10);
    expect(bybit.setLeverage).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 10, 'ARG_BTL');

    await client.setMarginMode(ctx, 'BTCUSDT', 'ISOLATED', 10);
    expect(bybit.setMarginMode).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'ISOLATED', 10, 'ARG_BTL');

    await client.getWalletBalance(ctx);
    expect(bybit.getWalletBalance).toHaveBeenCalledWith('key', 'secret', false, 'ARG_BTL');

    await client.getLastTradePrice(ctx, 'BTCUSDT');
    expect(bybit.getLastTradePrice).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'ARG_BTL');

    await client.getOpenOrders(ctx, 'BTCUSDT');
    expect(bybit.getOpenOrders).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'ARG_BTL');

    await client.getOrderInfo(ctx, 'BTCUSDT', 'o1');
    expect(bybit.getOrderInfo).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'o1', 'ARG_BTL');

    await client.getOrderHistory(ctx, 'BTCUSDT', 'o1');
    expect(bybit.getOrderHistory).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'o1', 'ARG_BTL');

    await client.cancelAllOrders(ctx, 'BTCUSDT');
    expect(bybit.cancelAllOrders).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'ARG_BTL');

    await client.detectPositionMode(ctx, 'BTCUSDT');
    expect(bybit.detectPositionMode).toHaveBeenCalledWith('key', 'secret', false, 'BTCUSDT', 'ARG_BTL');
  });
});
