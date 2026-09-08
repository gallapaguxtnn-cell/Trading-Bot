import { shouldRepriceProtection } from './protection-reprice.util';

describe('shouldRepriceProtection', () => {
  it('caso real SUIUSDT: SL vigente 0.8015 vs alvo correto 0.81192 (2% sobre o fill 0.796) -> reposiciona', () => {
    const result = shouldRepriceProtection({ currentPrice: 0.8015, targetPrice: 0.81192 });
    expect(result.shouldReprice).toBe(true);
    expect(result.diffPercent).toBeCloseTo(1.2834, 3);
  });

  it('SL vigente igual ao alvo -> nao reposiciona', () => {
    const result = shouldRepriceProtection({ currentPrice: 0.81192, targetPrice: 0.81192 });
    expect(result.shouldReprice).toBe(false);
    expect(result.diffPercent).toBe(0);
  });

  it('diferenca minuscula por arredondamento (dentro da tolerancia de 0,05 p.p.) -> nao reposiciona', () => {
    const result = shouldRepriceProtection({ currentPrice: 0.81190, targetPrice: 0.81192 });
    expect(result.shouldReprice).toBe(false);
  });

  it('diferenca logo acima da tolerancia -> reposiciona', () => {
    const result = shouldRepriceProtection({ currentPrice: 100, targetPrice: 100.06 });
    expect(result.shouldReprice).toBe(true);
  });

  it('tolerancia customizada', () => {
    const result = shouldRepriceProtection({ currentPrice: 100, targetPrice: 100.2, tolerancePercent: 0.5 });
    expect(result.shouldReprice).toBe(false);
  });

  it('sem preco atual conhecido (trade antigo sem currentStopLoss) -> nao reposiciona, sinaliza indisponivel', () => {
    const result = shouldRepriceProtection({ currentPrice: null, targetPrice: 100 });
    expect(result.shouldReprice).toBe(false);
    expect(result.diffPercent).toBeNull();
  });

  it('preco atual invalido (zero ou negativo) -> nao reposiciona', () => {
    expect(shouldRepriceProtection({ currentPrice: 0, targetPrice: 100 }).shouldReprice).toBe(false);
    expect(shouldRepriceProtection({ currentPrice: -5, targetPrice: 100 }).shouldReprice).toBe(false);
  });
});
