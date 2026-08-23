import { findResidualTradeMatch, isDustByNotional } from './orphan-import.util';

describe('findResidualTradeMatch', () => {
  it('caso real: posicao orfa com entryPrice 0.65470 casa com trade fechado ha pouco no mesmo preco', () => {
    const candidates = [{ id: 'trade-b', entryPrice: 0.65470 }];
    const match = findResidualTradeMatch(candidates, 0.65470);
    expect(match).toEqual({ id: 'trade-b', entryPrice: 0.65470 });
  });

  it('dentro da tolerancia padrao (0.1%) ainda casa', () => {
    const candidates = [{ id: 'trade-b', entryPrice: 0.65470 }];
    const match = findResidualTradeMatch(candidates, 0.65530);
    expect(match?.id).toBe('trade-b');
  });

  it('fora da tolerancia nao casa (posicao realmente nova, nao residuo)', () => {
    const candidates = [{ id: 'trade-b', entryPrice: 0.65470 }];
    const match = findResidualTradeMatch(candidates, 0.70000);
    expect(match).toBeNull();
  });

  it('lista vazia -> null', () => {
    expect(findResidualTradeMatch([], 0.65470)).toBeNull();
  });

  it('primeiro candidato compativel (mais recente, lista ja ordenada por closedAt desc) e retornado', () => {
    const candidates = [
      { id: 'mais-recente', entryPrice: 0.65470 },
      { id: 'mais-antigo', entryPrice: 0.65470 },
    ];
    expect(findResidualTradeMatch(candidates, 0.65470)?.id).toBe('mais-recente');
  });

  it('entryPrice zero ou negativo no candidato e ignorado (evita divisao por zero)', () => {
    const candidates = [{ id: 'invalido', entryPrice: 0 }];
    expect(findResidualTradeMatch(candidates, 0.65470)).toBeNull();
  });
});

describe('isDustByNotional', () => {
  it('caso real: quantidade zero (card D, DUST_AMOUNT) e sempre poeira', () => {
    expect(isDustByNotional(0, 0.71930, 1)).toBe(true);
  });

  it('nocional abaixo do piso configurado -> poeira', () => {
    expect(isDustByNotional(1, 0.5, 1)).toBe(true);
  });

  it('nocional acima do piso -> nao e poeira', () => {
    expect(isDustByNotional(895, 0.65470, 1)).toBe(false);
  });

  it('nocional exatamente no piso nao e considerado poeira (usa <, nao <=)', () => {
    expect(isDustByNotional(2, 0.5, 1)).toBe(false);
  });
});
