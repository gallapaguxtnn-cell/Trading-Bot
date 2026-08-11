import { mapBybitFill, mapBinanceFill } from './fill.util';

describe('FASE 1: mapeamento de fill da corretora', () => {
  it('Bybit com avgPrice/cumExecQty/cumExecFee/updatedTime → objeto correto', () => {
    const f = mapBybitFill({
      orderStatus: 'Filled',
      avgPrice: '3.893',
      cumExecQty: '2.6',
      cumExecFee: '0.0012',
      updatedTime: '1730000000000',
    });
    expect(f).toEqual({
      status: 'Filled',
      avgPrice: 3.893,
      executedQty: 2.6,
      fee: 0.0012,
      updatedAt: new Date(1730000000000),
    });
  });

  it('Bybit sem avgPrice (ordem não preenchida) → avgPrice/qty null, status preservado', () => {
    const f = mapBybitFill({ orderStatus: 'New', avgPrice: '0', cumExecQty: '0' });
    expect(f?.status).toBe('New');
    expect(f?.avgPrice).toBeNull();
    expect(f?.executedQty).toBeNull();
    expect(f?.fee).toBeNull();
    expect(f?.updatedAt).toBeNull();
  });

  it('Bybit orderInfo null (erro/sem dados) → fill null, nenhuma exceção', () => {
    expect(mapBybitFill(null)).toBeNull();
    expect(mapBybitFill(undefined)).toBeNull();
  });

  it('Binance mapeia status/avgPrice/executedQty/updateTime; fee null (rota não traz)', () => {
    const f = mapBinanceFill({ status: 'FILLED', avgPrice: '3.891', executedQty: '2.6', updateTime: 1730000000000 });
    expect(f).toEqual({
      status: 'FILLED',
      avgPrice: 3.891,
      executedQty: 2.6,
      fee: null,
      updatedAt: new Date(1730000000000),
    });
  });

  it('valores NaN/undefined não quebram (viram null)', () => {
    const f = mapBybitFill({ orderStatus: 'Filled', avgPrice: 'abc', cumExecQty: '', cumExecFee: undefined, updatedTime: 'x' });
    expect(f?.status).toBe('Filled');
    expect(f?.avgPrice).toBeNull();
    expect(f?.executedQty).toBeNull();
    expect(f?.fee).toBeNull();
    expect(f?.updatedAt).toBeNull();
  });
});
