import { normalizeTimeframe, resolveTimeframe, computeBufferExpiry } from './buffer-expiry.util';

describe('normalizeTimeframe', () => {
  it('maps TradingView numeric intervals', () => {
    expect(normalizeTimeframe('60')).toBe('1h');
    expect(normalizeTimeframe('240')).toBe('4h');
    expect(normalizeTimeframe('15')).toBe('15m');
  });

  it('maps daily aliases', () => {
    expect(normalizeTimeframe('D')).toBe('1d');
    expect(normalizeTimeframe('d')).toBe('1d');
    expect(normalizeTimeframe('1440')).toBe('1d');
  });

  it('accepts canonical values and rejects unknowns', () => {
    expect(normalizeTimeframe('1h')).toBe('1h');
    expect(normalizeTimeframe('  30m ')).toBe('30m');
    expect(normalizeTimeframe('')).toBeNull();
    expect(normalizeTimeframe(null)).toBeNull();
    expect(normalizeTimeframe('7m')).toBeNull();
  });
});

describe('resolveTimeframe', () => {
  it('prefers the signal timeframe over the strategy timeframe', () => {
    expect(resolveTimeframe('15', '1h')).toBe('15m');
  });

  it('falls back to the strategy timeframe when the signal has none', () => {
    expect(resolveTimeframe(null, '4h')).toBe('4h');
    expect(resolveTimeframe('', '240')).toBe('4h');
  });

  it('returns null when neither is set', () => {
    expect(resolveTimeframe(null, null)).toBeNull();
  });
});

describe('computeBufferExpiry', () => {
  it('expires at the close of the next 1h candle', () => {
    const received = new Date('2026-08-12T22:00:03.000Z');
    expect(computeBufferExpiry(received, '1h', 1)?.toISOString()).toBe('2026-08-12T23:00:00.000Z');
  });

  it('handles the boundary just before the candle close', () => {
    const received = new Date('2026-08-12T22:59:58.000Z');
    expect(computeBufferExpiry(received, '1h', 1)?.toISOString()).toBe('2026-08-12T23:00:00.000Z');
  });

  it('extends the window with candles = 2', () => {
    const received = new Date('2026-08-12T22:00:03.000Z');
    expect(computeBufferExpiry(received, '1h', 2)?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('works for a 15m timeframe', () => {
    const received = new Date('2026-08-12T10:16:04.000Z');
    expect(computeBufferExpiry(received, '15m', 1)?.toISOString()).toBe('2026-08-12T10:30:00.000Z');
  });

  it('defaults candles to 1 and clamps invalid values', () => {
    const received = new Date('2026-08-12T22:00:03.000Z');
    expect(computeBufferExpiry(received, '1h')?.toISOString()).toBe('2026-08-12T23:00:00.000Z');
    expect(computeBufferExpiry(received, '1h', 0)?.toISOString()).toBe('2026-08-12T23:00:00.000Z');
  });

  it('returns null for an unknown timeframe', () => {
    const received = new Date('2026-08-12T22:00:03.000Z');
    expect(computeBufferExpiry(received, '7m', 1)).toBeNull();
  });
});
