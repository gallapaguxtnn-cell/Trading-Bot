jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { BinanceClientService } from './binance-client.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { AccountContext } from './exchange-client.interface';

function makeCtx(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    credentials: { apiKey: 'key', apiSecret: 'secret' },
    mode: 'REAL',
    region: null,
    ...overrides,
  };
}

describe('BinanceClientService (extrai as chamadas HTTP hoje espalhadas por webhook/stop-loss/take-profit/position-sync)', () => {
  let symbolRulesService: { getSymbolRules: jest.Mock };
  let client: BinanceClientService;

  beforeEach(() => {
    jest.resetAllMocks();
    RateLimiterUtil.getInstance().clearCache();
    symbolRulesService = {
      getSymbolRules: jest.fn().mockResolvedValue({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' }),
    };
    client = new BinanceClientService(symbolRulesService as unknown as SymbolRulesService);
  });

  it('mode REAL -> api.binance.com mainnet; mode DEMO -> testnet.binancefuture.com', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { orderId: 1 } });

    await client.createOrder(makeCtx({ mode: 'REAL' }), { symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', qty: '1' });
    expect((BinanceRequestUtil.post as jest.Mock).mock.calls[0][0]).toContain('fapi.binance.com');

    await client.createOrder(makeCtx({ mode: 'DEMO' }), { symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', qty: '1' });
    expect((BinanceRequestUtil.post as jest.Mock).mock.calls[1][0]).toContain('testnet.binancefuture.com');
  });

  it('createOrder MARKET one-way: nao envia positionSide nem reduceOnly quando hedgeMode e reduceOnly sao omitidos', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { orderId: 42 } });

    const result = await client.createOrder(makeCtx(), { symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', qty: '1' });

    expect(result).toEqual({ orderId: '42' });
    const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(body);
    expect(params.get('symbol')).toBe('BTCUSDT');
    expect(params.get('side')).toBe('BUY');
    expect(params.get('type')).toBe('MARKET');
    expect(params.get('quantity')).toBe('1');
    expect(params.has('positionSide')).toBe(false);
    expect(params.has('reduceOnly')).toBe(false);
  });

  it('createOrder LIMIT hedge mode: inclui price, timeInForce=GTC e positionSide derivado do side', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { orderId: 43 } });

    await client.createOrder(makeCtx(), { symbol: 'BTCUSDT', side: 'SELL', orderType: 'LIMIT', qty: '1', price: '50000', hedgeMode: true });

    const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(body);
    expect(params.get('price')).toBe('50000');
    expect(params.get('timeInForce')).toBe('GTC');
    expect(params.get('positionSide')).toBe('SHORT');
  });

  it('createOrder reduceOnly explicito em one-way mode', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { orderId: 44 } });

    await client.createOrder(makeCtx(), { symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', qty: '1', reduceOnly: true });

    const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(body);
    expect(params.get('reduceOnly')).toBe('true');
  });

  it('createOrder hedge mode fechando posicao: positionSide vem de positionSide explicito (posicao original), nao do side transacional invertido', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { orderId: 45 } });

    await client.createOrder(makeCtx(), {
      symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', qty: '1',
      reduceOnly: true, hedgeMode: true, positionSide: 'BUY',
    });

    const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(body);
    expect(params.get('side')).toBe('SELL');
    expect(params.get('positionSide')).toBe('LONG');
  });

  it('createOrder: erro -4061 em hedge mode -> reenvia com reduceOnly no lugar de positionSide', async () => {
    (BinanceRequestUtil.post as jest.Mock)
      .mockRejectedValueOnce({ response: { data: { code: -4061 } } })
      .mockResolvedValueOnce({ data: { orderId: 46 } });

    const result = await client.createOrder(makeCtx(), { symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', qty: '1', hedgeMode: true });

    expect(result).toEqual({ orderId: '46' });
    const retryBody = (BinanceRequestUtil.post as jest.Mock).mock.calls[1][1] as string;
    const retryParams = new URLSearchParams(retryBody);
    expect(retryParams.has('positionSide')).toBe(false);
    expect(retryParams.get('reduceOnly')).toBe('true');
  });

  it('createStopLossOrder: usa a rota algo (STOP_MARKET), normaliza qty/preco pelo SymbolRulesService e usa reduceOnly em one-way', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValue({ data: { algoId: 999 } });

    const result = await client.createStopLossOrder(makeCtx(), 'BTCUSDT', 'BUY', '1.2345', '49000.123', false);

    expect(result).toEqual({ orderId: '999' });
    const url = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('/fapi/v1/algoOrder');
    const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
    const params = new URLSearchParams(body);
    expect(params.get('side')).toBe('SELL');
    expect(params.get('type')).toBe('STOP_MARKET');
    expect(params.get('algoType')).toBe('CONDITIONAL');
    expect(params.get('workingType')).toBe('MARK_PRICE');
    expect(params.get('reduceOnly')).toBe('true');
    expect(symbolRulesService.getSymbolRules).toHaveBeenCalledWith('BTCUSDT', false, 'binance');
  });

  it('createStopLossOrder: erro -4061 (position side mismatch) com hedgeMode -> reenvia com reduceOnly em vez de positionSide', async () => {
    (BinanceRequestUtil.post as jest.Mock)
      .mockRejectedValueOnce({ response: { data: { code: -4061 } } })
      .mockResolvedValueOnce({ data: { algoId: 1000 } });

    const result = await client.createStopLossOrder(makeCtx(), 'BTCUSDT', 'BUY', '1', '49000', true);

    expect(result).toEqual({ orderId: '1000' });
    expect(BinanceRequestUtil.post).toHaveBeenCalledTimes(2);
    const retryBody = (BinanceRequestUtil.post as jest.Mock).mock.calls[1][1] as string;
    const retryParams = new URLSearchParams(retryBody);
    expect(retryParams.has('positionSide')).toBe(false);
    expect(retryParams.get('reduceOnly')).toBe('true');
  });

  it('createStopLossOrder: erro que nao e -4061 propaga sem retry', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockRejectedValueOnce({ response: { data: { code: -2019, msg: 'Margin is insufficient' } } });

    await expect(client.createStopLossOrder(makeCtx(), 'BTCUSDT', 'BUY', '1', '49000', true)).rejects.toBeTruthy();
    expect(BinanceRequestUtil.post).toHaveBeenCalledTimes(1);
  });

  it('cancelOrder: tenta como algo order primeiro; se -4143/-1102, cai para ordem regular', async () => {
    (BinanceRequestUtil.delete as jest.Mock)
      .mockRejectedValueOnce({ response: { data: { code: -4143 } } })
      .mockResolvedValueOnce({ data: {} });

    const ok = await client.cancelOrder(makeCtx(), 'BTCUSDT', 'o1');

    expect(ok).toBe(true);
    expect(BinanceRequestUtil.delete).toHaveBeenCalledTimes(2);
    expect((BinanceRequestUtil.delete as jest.Mock).mock.calls[0][0]).toContain('/fapi/v1/algoOrder');
    expect((BinanceRequestUtil.delete as jest.Mock).mock.calls[1][0]).toContain('/fapi/v1/order?');
  });

  it('cancelOrder: algo cancela direto quando a ordem e algo (nao tenta regular)', async () => {
    (BinanceRequestUtil.delete as jest.Mock).mockResolvedValueOnce({ data: {} });

    const ok = await client.cancelOrder(makeCtx(), 'BTCUSDT', 'algo-1');

    expect(ok).toBe(true);
    expect(BinanceRequestUtil.delete).toHaveBeenCalledTimes(1);
  });

  it('cancelAllOrders sem positionSide: cancela tudo do simbolo (regular + algo), sem filtro -- comportamento one-way', async () => {
    (BinanceRequestUtil.delete as jest.Mock).mockResolvedValue({ data: {} });
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: [{ algoId: 1 }, { algoId: 2 }] });

    const ok = await client.cancelAllOrders(makeCtx(), 'BTCUSDT');

    expect(ok).toBe(true);
    expect((BinanceRequestUtil.delete as jest.Mock).mock.calls[0][0]).toContain('/fapi/v1/allOpenOrders');
    expect(BinanceRequestUtil.delete).toHaveBeenCalledTimes(3);
  });

  it('cancelAllOrders com positionSide: cancela so as ordens (regulares e algo) daquele lado ou BOTH -- preserva a posicao oposta em hedge mode', async () => {
    (BinanceRequestUtil.get as jest.Mock)
      .mockResolvedValueOnce({ data: [
        { orderId: 1, positionSide: 'LONG' },
        { orderId: 2, positionSide: 'SHORT' },
        { orderId: 3, positionSide: 'BOTH' },
      ] })
      .mockResolvedValueOnce({ data: [
        { algoId: 10, positionSide: 'LONG' },
        { algoId: 11, positionSide: 'SHORT' },
      ] });
    (BinanceRequestUtil.delete as jest.Mock).mockResolvedValue({ data: {} });

    const ok = await client.cancelAllOrders(makeCtx(), 'BTCUSDT', 'BUY');

    expect(ok).toBe(true);
    const deleteUrls = (BinanceRequestUtil.delete as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(deleteUrls.some((u) => u.includes('orderId=1'))).toBe(true);
    expect(deleteUrls.some((u) => u.includes('orderId=3'))).toBe(true);
    expect(deleteUrls.some((u) => u.includes('orderId=2'))).toBe(false);
    expect(deleteUrls.some((u) => u.includes('algoId=10'))).toBe(true);
    expect(deleteUrls.some((u) => u.includes('algoId=11'))).toBe(false);
  });

  it('getOrderInfo: tenta algoOrder primeiro; erro nao-4143/1102/2013 -> null sem tentar regular', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockRejectedValueOnce({ response: { data: { code: -1021 } } });

    const info = await client.getOrderInfo(makeCtx(), 'BTCUSDT', 'o1');

    expect(info).toBeNull();
    expect(BinanceRequestUtil.get).toHaveBeenCalledTimes(1);
  });

  it('getOrderInfo: algoOrder nao encontrado (-4143) -> cai para ordem regular e mapeia os campos', async () => {
    (BinanceRequestUtil.get as jest.Mock)
      .mockRejectedValueOnce({ response: { data: { code: -4143 } } })
      .mockResolvedValueOnce({ data: { orderId: 55, symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '50000', origQty: '1', status: 'FILLED', avgPrice: '50010', executedQty: '1', updateTime: 123 } });

    const info = await client.getOrderInfo(makeCtx(), 'BTCUSDT', '55');

    expect(info).toEqual({
      orderId: '55', symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', price: '50000', qty: '1',
      orderStatus: 'FILLED', avgPrice: '50010', cumExecQty: '1', cumExecFee: undefined, updatedTime: '123',
    });
  });

  it('getOrderHistory delega para getOrderInfo (Binance nao tem endpoint separado de historico)', async () => {
    const spy = jest.spyOn(client, 'getOrderInfo').mockResolvedValue(null);
    await client.getOrderHistory(makeCtx(), 'BTCUSDT', 'o1');
    expect(spy).toHaveBeenCalledWith(makeCtx(), 'BTCUSDT', 'o1');
  });

  it('getPositions: filtra positionAmt=0, converte side/size a partir do sinal da quantidade', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
      data: [
        { symbol: 'BTCUSDT', positionAmt: '1.5', entryPrice: '50000', unRealizedProfit: '10', leverage: '10', markPrice: '50100' },
        { symbol: 'ETHUSDT', positionAmt: '-2', entryPrice: '3000', unRealizedProfit: '-5', leverage: '5', markPrice: '2990' },
        { symbol: 'SOLUSDT', positionAmt: '0', entryPrice: '0', unRealizedProfit: '0', leverage: '1', markPrice: '100' },
      ],
    });

    const positions = await client.getPositions(makeCtx());

    expect(positions).toEqual([
      expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY', size: '1.5' }),
      expect.objectContaining({ symbol: 'ETHUSDT', side: 'SELL', size: '2' }),
    ]);
  });

  it('getWalletBalance: usa availableBalance quando positivo, senao cai para balance; lanca se USDT nao existir', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
      data: [{ asset: 'USDT', availableBalance: '123.45', balance: '200' }],
    });
    expect(await client.getWalletBalance(makeCtx())).toBe(123.45);

    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
      data: [{ asset: 'USDT', availableBalance: '0', balance: '77.5' }],
    });
    expect(await client.getWalletBalance(makeCtx())).toBe(77.5);

    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: [{ asset: 'BNB', availableBalance: '5', balance: '5' }] });
    await expect(client.getWalletBalance(makeCtx())).rejects.toThrow('USDT balance not found');
  });

  it('getCurrentPrice: endpoint publico, sem assinatura, devolve 0 em erro', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: { price: '50000.5' } });
    expect(await client.getCurrentPrice(makeCtx(), 'BTCUSDT')).toBe(50000.5);

    (BinanceRequestUtil.get as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
    expect(await client.getCurrentPrice(makeCtx(), 'BTCUSDT')).toBe(0);
  });

  it('getLastTradePrice: devolve o preco do trade mais recente ou null se vazio/erro', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: [{ price: '50005' }] });
    expect(await client.getLastTradePrice(makeCtx(), 'BTCUSDT')).toBe(50005);

    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: [] });
    expect(await client.getLastTradePrice(makeCtx(), 'BTCUSDT')).toBeNull();
  });

  it('setTradingStop e clearTradingStop lancam erro explicito -- Binance nao tem SL/TP a nivel de posicao', () => {
    expect(() => client.setTradingStop()).toThrow('nao e suportado pela Binance');
    expect(() => client.clearTradingStop()).toThrow('nao e suportado pela Binance');
  });

  it('getPositionIdx devolve sempre 0 -- Binance nao usa positionIdx (posicao resolvida via hedgeMode/positionSide)', async () => {
    expect(await client.getPositionIdx()).toBe(0);
  });

  it('waitForPosition: resolve true assim que a posicao aparecer, tenta ate maxRetries e desiste devolvendo false', async () => {
    (BinanceRequestUtil.get as jest.Mock)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ symbol: 'BTCUSDT', positionAmt: '1', entryPrice: '1', unRealizedProfit: '0', leverage: '1', markPrice: '1' }] });

    const ok = await client.waitForPosition(makeCtx(), 'BTCUSDT', 'BUY', 5, 1);
    expect(ok).toBe(true);
    expect(BinanceRequestUtil.get).toHaveBeenCalledTimes(2);
  });

  it('waitForPosition: nunca aparece -> false apos maxRetries', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValue({ data: [] });

    const ok = await client.waitForPosition(makeCtx(), 'BTCUSDT', 'BUY', 2, 1);
    expect(ok).toBe(false);
    expect(BinanceRequestUtil.get).toHaveBeenCalledTimes(2);
  });

  it('getSymbolRules delega para o SymbolRulesService compartilhado com exchange=binance', async () => {
    await client.getSymbolRules(makeCtx({ mode: 'DEMO' }), 'BTCUSDT');
    expect(symbolRulesService.getSymbolRules).toHaveBeenCalledWith('BTCUSDT', true, 'binance');
  });

  it('setMarginMode: erro -4046 (ja configurado) nao propaga', async () => {
    (BinanceRequestUtil.post as jest.Mock).mockRejectedValueOnce({ response: { data: { code: -4046 } } });
    await expect(client.setMarginMode(makeCtx(), 'BTCUSDT', 'ISOLATED', 10)).resolves.toBeUndefined();
  });

  it('ensurePositionMode: modo ja correto -> nao chama a API', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: { dualSidePosition: true } });
    await client.ensurePositionMode(makeCtx(), 'BTCUSDT', true);
    expect(BinanceRequestUtil.post).not.toHaveBeenCalled();
  });

  it('ensurePositionMode: modo errado -> chama positionSide/dual', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: { dualSidePosition: false } });
    (BinanceRequestUtil.post as jest.Mock).mockResolvedValueOnce({ data: {} });
    await client.ensurePositionMode(makeCtx(), 'BTCUSDT', true);
    expect(BinanceRequestUtil.post).toHaveBeenCalledTimes(1);
    expect((BinanceRequestUtil.post as jest.Mock).mock.calls[0][0]).toContain('/fapi/v1/positionSide/dual');
  });

  it('ensurePositionMode: -4059 (posicoes abertas) lanca erro claro', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: { dualSidePosition: false } });
    (BinanceRequestUtil.post as jest.Mock).mockRejectedValueOnce({ response: { data: { code: -4059 } } });

    await expect(client.ensurePositionMode(makeCtx(), 'BTCUSDT', true)).rejects.toThrow('Cannot change position mode while positions are open');
  });
});
