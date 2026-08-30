import { normalizeQuantity, roundPriceToTick, isMultipleOfStep } from './exchange-precision.util';

describe('Cenario de aceite: PLANO_FIX_ARREDONDAMENTO_GLOBAL (precisao por faixa de preco)', () => {
  describe('BTCUSDT (preco alto, ~60000, tick 0.10, step 0.001)', () => {
    it('preco sai valido e alinhado ao tick real', () => {
      const price = roundPriceToTick(58800.37, '0.10');
      expect(isMultipleOfStep(price, '0.10')).toBe(true);
      expect(Number(price)).toBeCloseTo(58800.4, 8);
    });

    it('0.005 BTC NUNCA vira 0.01 (o dobro da posicao) -- o defeito exato do toFixed(2) nativo do JS', () => {
      expect((0.005).toFixed(2)).toBe('0.01');

      const normalized = normalizeQuantity(0.005, '0.001', '0.001');
      expect(normalized).toBe('0.005');
      expect(Number(normalized)).toBeLessThanOrEqual(0.005);
    });

    it('0.004 BTC nao vira 0.00 (ficaria sem stop) quando o step permite representa-lo', () => {
      const normalized = normalizeQuantity(0.004, '0.001', '0.001');
      expect(normalized).toBe('0.004');
      expect(Number(normalized)).toBeGreaterThan(0);
    });
  });

  describe('SUIUSDT (preco medio, ~0.75, tick 0.0001, step 1)', () => {
    it('SL recriado mantem 4 casas (0.7697), nunca vira 0.77', () => {
      const price = roundPriceToTick(0.7697, '0.0001');
      expect(price).toBe('0.7697');
      expect(price).not.toBe('0.77');
    });

    it('quantidade inteira sai valida e multipla do step', () => {
      const qty = normalizeQuantity(59.9125364431, '1', '1');
      expect(qty).toBe('59');
      expect(isMultipleOfStep(qty, '1')).toBe(true);
    });
  });

  describe('ativo de preco micro (tipo PEPE/SHIB, tick 0.00000001, step grande)', () => {
    it('preco sai valido e diferente de zero -- nunca 0.00 (o que a corretora rejeitaria)', () => {
      const price = roundPriceToTick(0.00000912, '0.00000001');
      expect(price).toBe('0.00000912');
      expect(Number(price)).toBeGreaterThan(0);
    });

    it('quantidade com step grande (1000000) ainda normaliza corretamente e nunca aumenta', () => {
      const qty = normalizeQuantity(123456789, '1000000', '1000000');
      expect(qty).toBe('123000000');
      expect(Number(qty)).toBeLessThanOrEqual(123456789);
      expect(isMultipleOfStep(qty, '1000000')).toBe(true);
    });
  });

  it('nas tres faixas, o floor nunca aumenta a quantidade original', () => {
    const cases: Array<{ value: number; step: string; minQty: string }> = [
      { value: 0.005, step: '0.001', minQty: '0.001' },
      { value: 59.9125364431, step: '1', minQty: '1' },
      { value: 123456789, step: '1000000', minQty: '1000000' },
    ];

    for (const { value, step, minQty } of cases) {
      const normalized = Number(normalizeQuantity(value, step, minQty));
      expect(normalized).toBeLessThanOrEqual(value);
    }
  });
});
