import { mapBybitFill, mapBinanceFill, weightedAvgPrice, tpPnl, latestUpdatedAt } from './fill.util';

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

describe('FASE 2: preço/PnL/hora reais no fechamento por TP (caso real)', () => {
  const fills = [
    { status: 'Filled', avgPrice: 3.893, executedQty: 2.6, fee: 0.0011, updatedAt: new Date(1730000000000) },
    { status: 'Filled', avgPrice: 3.891, executedQty: 2.6, fee: 0.0011, updatedAt: new Date(1730000005000) },
    { status: 'Filled', avgPrice: 3.8925, executedQty: 2.7, fee: 0.0011, updatedAt: new Date(1730000002000) },
  ];

  it('exitPrice = média ponderada Σ(preço×qtd)/Σqtd', () => {
    const expected = (3.893 * 2.6 + 3.891 * 2.6 + 3.8925 * 2.7) / (2.6 + 2.6 + 2.7);
    expect(weightedAvgPrice(fills)).toBeCloseTo(expected, 10);
    expect(weightedAvgPrice(fills)).toBeCloseTo(3.8921708861, 9);
  });

  it('closedAt = maior updatedAt entre os fills (não o do cron)', () => {
    expect(latestUpdatedAt(fills)).toEqual(new Date(1730000005000));
  });

  it('pnl total = soma dos líquidos por nível (LONG, líquido de taxa)', () => {
    const entry = 3.88;
    const total = fills.reduce((s, f) => s + tpPnl('BUY', entry, f.avgPrice, f.executedQty, f.fee).net, 0);
    const expected =
      ((3.893 - 3.88) * 2.6 - 0.0011) +
      ((3.891 - 3.88) * 2.6 - 0.0011) +
      ((3.8925 - 3.88) * 2.7 - 0.0011);
    expect(total).toBeCloseTo(expected, 10);
  });

  it('SHORT inverte o sinal (entrada − saída)', () => {
    const { gross, net } = tpPnl('SELL', 3.90, 3.893, 2.6, 0.001);
    expect(gross).toBeCloseTo((3.90 - 3.893) * 2.6, 10);
    expect(net).toBeCloseTo((3.90 - 3.893) * 2.6 - 0.001, 10);
  });

  it('fee ausente (null) não quebra o PnL líquido', () => {
    expect(tpPnl('BUY', 3.88, 3.893, 2.6, null).net).toBeCloseTo((3.893 - 3.88) * 2.6, 10);
  });

  it('nenhum fill com preço → weightedAvgPrice null (cai no fallback de mercado)', () => {
    expect(weightedAvgPrice([{ status: 'Filled', avgPrice: null, executedQty: null, fee: null, updatedAt: null }])).toBeNull();
    expect(latestUpdatedAt([{ status: 'New', avgPrice: null, executedQty: null, fee: null, updatedAt: null }])).toBeNull();
  });
});

describe('FASE 3: mapCcxtFill (retorno de createMarketOrder)', () => {
  const { mapCcxtFill } = require('./fill.util');

  it('mapeia average/filled/fee.cost/timestamp', () => {
    const f = mapCcxtFill({ status: 'closed', average: 3.892, filled: 7.9, fee: { cost: 0.0031 }, timestamp: 1730000000000 });
    expect(f).toEqual({ status: 'closed', avgPrice: 3.892, executedQty: 7.9, fee: 0.0031, updatedAt: new Date(1730000000000) });
  });

  it('prefere lastUpdateTimestamp quando presente', () => {
    const f = mapCcxtFill({ average: 3.9, filled: 1, timestamp: 1, lastUpdateTimestamp: 1730000009000 });
    expect(f.updatedAt).toEqual(new Date(1730000009000));
  });

  it('order null → null; sem average → avgPrice null (cai no preço de gatilho)', () => {
    expect(mapCcxtFill(null)).toBeNull();
    const f = mapCcxtFill({ status: 'open', filled: 0 });
    expect(f.avgPrice).toBeNull();
    expect(f.fee).toBeNull();
  });
});
