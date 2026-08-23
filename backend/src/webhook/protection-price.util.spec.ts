import { resolveProtectionPrice, resolveFinalEntryPrice } from './protection-price.util';

describe('resolveProtectionPrice', () => {
  it('Bybit MARKET com avgPrice disponivel -> usa o preco real de execucao (TP/SL sobre o fill)', () => {
    const result = resolveProtectionPrice({
      isLimitOrder: false,
      isAveragingTrade: false,
      actualEntryPrice: 0.65470,
      signalPrice: 0.65563,
    });
    expect(result).toEqual({ price: 0.65470, usedActualFill: true });
  });

  it('Bybit MARKET sem avgPrice disponivel -> cai no preco do sinal (sem quebrar)', () => {
    const result = resolveProtectionPrice({
      isLimitOrder: false,
      isAveragingTrade: false,
      actualEntryPrice: undefined,
      signalPrice: 0.65563,
    });
    expect(result).toEqual({ price: 0.65563, usedActualFill: false });
  });

  it('Binance MARKET com actualEntryPrice -> mesmo comportamento de sempre (usa o fill real)', () => {
    const result = resolveProtectionPrice({
      isLimitOrder: false,
      isAveragingTrade: false,
      actualEntryPrice: 100.05,
      signalPrice: 100,
    });
    expect(result).toEqual({ price: 100.05, usedActualFill: true });
  });

  it('LIMIT (qualquer corretora) -> sempre preco do sinal, mesmo com actualEntryPrice presente', () => {
    const result = resolveProtectionPrice({
      isLimitOrder: true,
      isAveragingTrade: false,
      actualEntryPrice: 100.05,
      signalPrice: 100,
    });
    expect(result).toEqual({ price: 100, usedActualFill: false });
  });

  it('averaging -> preco do sinal proposital, mesmo com actualEntryPrice presente (nao usa media pos-merge)', () => {
    const result = resolveProtectionPrice({
      isLimitOrder: false,
      isAveragingTrade: true,
      actualEntryPrice: 105,
      signalPrice: 110,
    });
    expect(result).toEqual({ price: 110, usedActualFill: false });
  });
});

describe('resolveFinalEntryPrice', () => {
  it('MARKET com actualEntryPrice -> grava o preco real (Binance e Bybit)', () => {
    expect(resolveFinalEntryPrice({ isLimitOrder: false, actualEntryPrice: 0.65470, fallbackPrice: 0.65563 })).toBe(0.65470);
  });

  it('MARKET sem actualEntryPrice -> grava o preco do sinal', () => {
    expect(resolveFinalEntryPrice({ isLimitOrder: false, actualEntryPrice: undefined, fallbackPrice: 0.65563 })).toBe(0.65563);
  });

  it('LIMIT -> sempre o preco de fallback (sinal), mesmo com actualEntryPrice presente', () => {
    expect(resolveFinalEntryPrice({ isLimitOrder: true, actualEntryPrice: 100.05, fallbackPrice: 100 })).toBe(100);
  });

  it('averaging nao exclui aqui (mesma semantica ja existente para Binance)', () => {
    expect(resolveFinalEntryPrice({ isLimitOrder: false, actualEntryPrice: 105, fallbackPrice: 110 })).toBe(105);
  });
});
