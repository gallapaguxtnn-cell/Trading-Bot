import { normalizeQuantity, roundPriceToTick, isMultipleOfStep } from './exchange-precision.util';

describe('normalizeQuantity', () => {
  it('floors to the step size', () => {
    expect(normalizeQuantity(1789.98, '1', '1')).toBe('1789');
    expect(normalizeQuantity(0.0287654321, '0.001', '0.001')).toBe('0.028');
  });

  it('never rounds up: a value just below the next step stays at the lower step', () => {
    expect(normalizeQuantity(0.005999, '0.001', '0.001')).toBe('0.005');
  });

  it('returns 0 when the floored result is zero (too small for the step)', () => {
    expect(normalizeQuantity(0.0007, '0.001', '0.001')).toBe('0');
  });

  it('returns 0 when the original value is already below minQty', () => {
    expect(normalizeQuantity(0.0004, '0.001', '0.001')).toBe('0');
  });

  it('clamps up to minQty only when the original value was valid but floor rounding pushed it under minQty', () => {
    expect(normalizeQuantity(2.9, '1', '2.5')).toBe('2.5');
  });

  it('throws for zero or negative input', () => {
    expect(() => normalizeQuantity(0, '1', '1')).toThrow('Invalid quantity');
    expect(() => normalizeQuantity(-5, '1', '1')).toThrow('Invalid quantity');
  });
});

describe('roundPriceToTick', () => {
  it('rounds to the nearest tick for a mid-price asset (SUI, tick 0.0001)', () => {
    expect(roundPriceToTick(0.7697, '0.0001')).toBe('0.7697');
    expect(roundPriceToTick(0.76971, '0.0001')).toBe('0.7697');
  });

  it('rounds to the nearest tick for a high-price asset (BTC, tick 0.10)', () => {
    expect(roundPriceToTick(58800.37, '0.10')).toBe('58800.4');
  });

  it('rounds to the nearest tick for a micro-price asset (PEPE-like, tick 0.00000001) without collapsing to zero', () => {
    const rounded = roundPriceToTick(0.00000912, '0.00000001');
    expect(rounded).toBe('0.00000912');
    expect(Number(rounded)).toBeGreaterThan(0);
  });
});

describe('isMultipleOfStep', () => {
  it('confirms exact multiples using Decimal, avoiding float artifacts like 0.1 + 0.2', () => {
    expect(isMultipleOfStep(0.3, '0.1')).toBe(true);
    expect(isMultipleOfStep('609', '1')).toBe(true);
    expect(isMultipleOfStep(1.03, '0.01')).toBe(true);
  });

  it('detects non-multiples', () => {
    expect(isMultipleOfStep(609.98, '1')).toBe(false);
    expect(isMultipleOfStep(0.0075, '0.001')).toBe(false);
  });
});
