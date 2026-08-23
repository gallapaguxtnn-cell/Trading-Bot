import { resolveBybitActualFillPrice } from './bybit-fill-price.util';

const noopSleep = () => Promise.resolve();

describe('resolveBybitActualFillPrice', () => {
  it('avgPrice disponivel na primeira tentativa -> retorna direto, sem retry nem fallback', async () => {
    const getOrderInfo = jest.fn().mockResolvedValue({ avgPrice: '0.65470' });
    const getOrderHistory = jest.fn();
    const getPositions = jest.fn();

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBe(0.65470);
    expect(getOrderInfo).toHaveBeenCalledTimes(1);
    expect(getOrderHistory).not.toHaveBeenCalled();
    expect(getPositions).not.toHaveBeenCalled();
  });

  it('avgPrice so aparece na 3a tentativa (ordem ainda preenchendo) -> retry ate achar', async () => {
    const getOrderInfo = jest.fn()
      .mockResolvedValueOnce({ avgPrice: '0' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ avgPrice: '0.65470' });
    const getOrderHistory = jest.fn();
    const getPositions = jest.fn();

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBe(0.65470);
    expect(getOrderInfo).toHaveBeenCalledTimes(3);
    expect(getOrderHistory).not.toHaveBeenCalled();
  });

  it('getOrderInfo esgota tentativas -> cai no getOrderHistory', async () => {
    const getOrderInfo = jest.fn().mockResolvedValue({ avgPrice: '0' });
    const getOrderHistory = jest.fn().mockResolvedValue({ avgPrice: '0.65470' });
    const getPositions = jest.fn();

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBe(0.65470);
    expect(getOrderInfo).toHaveBeenCalledTimes(3);
    expect(getOrderHistory).toHaveBeenCalledTimes(1);
    expect(getPositions).not.toHaveBeenCalled();
  });

  it('order info e history indisponiveis -> ultimo recurso: posicao aberta', async () => {
    const getOrderInfo = jest.fn().mockResolvedValue(null);
    const getOrderHistory = jest.fn().mockResolvedValue(null);
    const getPositions = jest.fn().mockResolvedValue([
      { side: 'Sell', size: '0', avgPrice: '0' },
      { side: 'Buy', size: '895', avgPrice: '0.65470' },
    ]);

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBe(0.65470);
  });

  it('nenhuma fonte tem preco -> undefined (sem lançar excecao; caller cai no preco do sinal com warning)', async () => {
    const getOrderInfo = jest.fn().mockResolvedValue(null);
    const getOrderHistory = jest.fn().mockResolvedValue(null);
    const getPositions = jest.fn().mockResolvedValue([]);

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBeUndefined();
  });

  it('posicao com side errado (Sell) nao e usada quando procurando Buy', async () => {
    const getOrderInfo = jest.fn().mockResolvedValue(null);
    const getOrderHistory = jest.fn().mockResolvedValue(null);
    const getPositions = jest.fn().mockResolvedValue([
      { side: 'Sell', size: '895', avgPrice: '0.65470' },
    ]);

    const price = await resolveBybitActualFillPrice({
      getOrderInfo, getOrderHistory, getPositions, side: 'Buy', sleep: noopSleep,
    });

    expect(price).toBeUndefined();
  });
});
