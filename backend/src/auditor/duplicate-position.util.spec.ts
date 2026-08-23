import { findDuplicatePositionGroups } from './duplicate-position.util';

function trade(overrides: Partial<{
  id: string; symbol: string; side: string; entryPrice: number; closedAt: string; pnl: number | null;
}> = {}) {
  return {
    id: 'trade',
    symbol: 'SUIUSDT',
    side: 'BUY',
    entryPrice: 0.65470,
    closedAt: '2026-08-19T05:00:00Z',
    pnl: 0,
    ...overrides,
  };
}

describe('findDuplicatePositionGroups', () => {
  it('caso real: A (LIMIT TP3 +5.4555) e B (MARKET MANUAL +2.506) mesma entrada -> um grupo com os dois', () => {
    const tradeA = trade({ id: 'trade-a', entryPrice: 0.65470, closedAt: '2026-08-19T04:30:00Z', pnl: 5.4555 });
    const tradeB = trade({ id: 'trade-b', entryPrice: 0.65470, closedAt: '2026-08-19T05:00:00Z', pnl: 2.506 });

    const groups = findDuplicatePositionGroups([tradeA, tradeB]);

    expect(groups).toHaveLength(1);
    expect(groups[0].trades.map(t => t.id).sort()).toEqual(['trade-a', 'trade-b']);
  });

  it('caso real: C+D (0.71930) e A+B (0.65470) sao grupos separados', () => {
    const tradeA = trade({ id: 'trade-a', entryPrice: 0.65470, pnl: 5.4555 });
    const tradeB = trade({ id: 'trade-b', entryPrice: 0.65470, pnl: 2.506 });
    const tradeC = trade({ id: 'trade-c', entryPrice: 0.71930, pnl: 0.2672 });
    const tradeD = trade({ id: 'trade-d', entryPrice: 0.71930, pnl: 0.0565 });

    const groups = findDuplicatePositionGroups([tradeA, tradeB, tradeC, tradeD]);

    expect(groups).toHaveLength(2);
    const idsPerGroup = groups.map(g => g.trades.map(t => t.id).sort());
    expect(idsPerGroup).toContainEqual(['trade-a', 'trade-b']);
    expect(idsPerGroup).toContainEqual(['trade-c', 'trade-d']);
  });

  it('trade unico (sem par) nao gera grupo (caso F, consolidado, ja tratado por excludeFromStats)', () => {
    const single = trade({ id: 'trade-f' });
    expect(findDuplicatePositionGroups([single])).toHaveLength(0);
  });

  it('mesmo symbol, side diferente (LONG vs SHORT) nao agrupa', () => {
    const long = trade({ id: 'trade-long', side: 'BUY' });
    const short = trade({ id: 'trade-short', side: 'SELL' });
    expect(findDuplicatePositionGroups([long, short])).toHaveLength(0);
  });

  it('entryPrice fora da tolerancia (posicoes realmente diferentes) nao agrupa', () => {
    const t1 = trade({ id: 't1', entryPrice: 0.65470 });
    const t2 = trade({ id: 't2', entryPrice: 0.70930 });
    expect(findDuplicatePositionGroups([t1, t2])).toHaveLength(0);
  });

  it('fora da janela de 24h nao agrupa (posicoes coincidentemente no mesmo preco em datas distantes)', () => {
    const t1 = trade({ id: 't1', entryPrice: 0.65470, closedAt: '2026-08-01T00:00:00Z' });
    const t2 = trade({ id: 't2', entryPrice: 0.65470, closedAt: '2026-08-19T00:00:00Z' });
    expect(findDuplicatePositionGroups([t1, t2])).toHaveLength(0);
  });

  it('3 trades na mesma posicao formam um unico grupo de 3 (nao 3 pares)', () => {
    const t1 = trade({ id: 't1', closedAt: '2026-08-19T04:00:00Z' });
    const t2 = trade({ id: 't2', closedAt: '2026-08-19T04:30:00Z' });
    const t3 = trade({ id: 't3', closedAt: '2026-08-19T05:00:00Z' });

    const groups = findDuplicatePositionGroups([t1, t2, t3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].trades).toHaveLength(3);
  });
});
