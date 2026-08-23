import { computePercentMismatch } from './percent-mismatch.util';

const baseStrategy = {
  stopLossPercentage: 1,
  takeProfitPercentage1: 0.3,
  takeProfitPercentage2: 0.6,
  takeProfitPercentage3: 1,
};

describe('computePercentMismatch', () => {
  it('caso real SUIUSDT: TP1 configurado 0.30% mas efetivo 0.443% -> TP_PERCENT_MISMATCH', () => {
    const result = computePercentMismatch({
      entryPrice: 0.65470,
      exitPrice: 0.65760,
      closeReason: 'TAKE_PROFIT_1',
      closeDetail: null,
      ...baseStrategy,
    });

    expect(result).not.toBeNull();
    expect(result!.category).toBe('TP_PERCENT_MISMATCH');
    expect(result!.effectivePercent).toBeCloseTo(0.4430, 3);
    expect(result!.configuredPercent).toBe(0.3);
    expect(result!.deviation).toBeCloseTo(0.1430, 3);
    expect(result!.severity).toBe('WARNING');
  });

  it('TP dentro da tolerancia (diff <= 0.05 p.p.) nao gera issue', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 100.32,
      closeReason: 'TAKE_PROFIT_1',
      closeDetail: null,
      ...baseStrategy,
    });

    expect(result).toBeNull();
  });

  it('SL efetivo diferente do configurado (dentro da zona WARNING) -> SL_PERCENT_MISMATCH', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 98.9,
      closeReason: 'STOP_LOSS',
      closeDetail: null,
      ...baseStrategy,
    });

    expect(result).not.toBeNull();
    expect(result!.category).toBe('SL_PERCENT_MISMATCH');
    expect(result!.effectivePercent).toBeCloseTo(1.1, 4);
    expect(result!.configuredPercent).toBe(1);
    expect(result!.severity).toBe('WARNING');
  });

  it('diff acima de 0.2 p.p. vira ERROR', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 97,
      closeReason: 'STOP_LOSS',
      closeDetail: null,
      ...baseStrategy,
    });

    expect(result!.severity).toBe('ERROR');
  });

  it('fechamento com multiplos TPs simultaneos (closeDetail preenchido) nao gera falso positivo', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 100.7,
      closeReason: 'TAKE_PROFIT_3',
      closeDetail: 'TP1+TP2+TP3 @12:00:00',
      ...baseStrategy,
    });

    expect(result).toBeNull();
  });

  it('closeReason MANUAL nao gera issue', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 105,
      closeReason: 'MANUAL',
      closeDetail: null,
      ...baseStrategy,
    });

    expect(result).toBeNull();
  });

  it('sem percentual configurado (0 ou null) nao gera issue', () => {
    const result = computePercentMismatch({
      entryPrice: 100,
      exitPrice: 105,
      closeReason: 'TAKE_PROFIT_2',
      closeDetail: null,
      stopLossPercentage: 1,
      takeProfitPercentage1: 0.3,
      takeProfitPercentage2: null,
      takeProfitPercentage3: 1,
    });

    expect(result).toBeNull();
  });

  it('sem exitPrice ou entryPrice nao gera issue', () => {
    expect(computePercentMismatch({
      entryPrice: 0,
      exitPrice: 105,
      closeReason: 'STOP_LOSS',
      closeDetail: null,
      ...baseStrategy,
    })).toBeNull();

    expect(computePercentMismatch({
      entryPrice: 100,
      exitPrice: 0,
      closeReason: 'STOP_LOSS',
      closeDetail: null,
      ...baseStrategy,
    })).toBeNull();
  });
});
