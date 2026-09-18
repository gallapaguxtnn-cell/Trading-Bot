import {
  isProtectionFallbackClose,
  isConsecutiveProtectionFallback,
  extractLastExchangeErrorMessage,
} from './protection-fallback.util';

describe('isProtectionFallbackClose', () => {
  it('true for both fallback close reasons', () => {
    expect(isProtectionFallbackClose('TAKE_PROFIT_FALLBACK_MARKET')).toBe(true);
    expect(isProtectionFallbackClose('STOP_LOSS_FALLBACK_MARKET')).toBe(true);
  });

  it('false for normal closes and for null/undefined', () => {
    expect(isProtectionFallbackClose('TAKE_PROFIT_1')).toBe(false);
    expect(isProtectionFallbackClose('STOP_LOSS')).toBe(false);
    expect(isProtectionFallbackClose('MANUAL')).toBe(false);
    expect(isProtectionFallbackClose(null)).toBe(false);
    expect(isProtectionFallbackClose(undefined)).toBe(false);
  });
});

describe('isConsecutiveProtectionFallback', () => {
  it('true when both the current and the previous close are fallback, regardless of TP/SL mix', () => {
    expect(isConsecutiveProtectionFallback('TAKE_PROFIT_FALLBACK_MARKET', 'STOP_LOSS_FALLBACK_MARKET')).toBe(true);
    expect(isConsecutiveProtectionFallback('STOP_LOSS_FALLBACK_MARKET', 'STOP_LOSS_FALLBACK_MARKET')).toBe(true);
    expect(isConsecutiveProtectionFallback('TAKE_PROFIT_FALLBACK_MARKET', 'TAKE_PROFIT_FALLBACK_MARKET')).toBe(true);
  });

  it('false when either side is a normal close', () => {
    expect(isConsecutiveProtectionFallback('TAKE_PROFIT_FALLBACK_MARKET', 'TAKE_PROFIT_1')).toBe(false);
    expect(isConsecutiveProtectionFallback('STOP_LOSS', 'STOP_LOSS_FALLBACK_MARKET')).toBe(false);
  });

  it('false when there is no previous close (first trade for the strategy)', () => {
    expect(isConsecutiveProtectionFallback('STOP_LOSS_FALLBACK_MARKET', null)).toBe(false);
    expect(isConsecutiveProtectionFallback('STOP_LOSS_FALLBACK_MARKET', undefined)).toBe(false);
  });
});

describe('extractLastExchangeErrorMessage', () => {
  it('prefers the raw SL_CREATION_FAILED reason from FASE 1 over tpWarnings', () => {
    const msg = extractLastExchangeErrorMessage({
      slWarnings: 'SL_CREATION_FAILED:retCode=110017: position idx not match position mode',
      tpWarnings: 'TP1:REJECTED_BY_EXCHANGE',
    });
    expect(msg).toBe('retCode=110017: position idx not match position mode');
  });

  it('ignores the SL_MISSING_RETRY token (FASE 2) -- only SL_CREATION_FAILED counts as a real exchange message', () => {
    const msg = extractLastExchangeErrorMessage({ slWarnings: 'SL_MISSING_RETRY:3', tpWarnings: null });
    expect(msg).toBeNull();
  });

  it('finds SL_CREATION_FAILED even when the SL_MISSING_RETRY token is also present in the same field', () => {
    const msg = extractLastExchangeErrorMessage({ slWarnings: 'SL_CREATION_FAILED:timeout;SL_MISSING_RETRY:2', tpWarnings: null });
    expect(msg).toBe('timeout');
  });

  it('falls back to tpWarnings when there is no SL_CREATION_FAILED token', () => {
    const msg = extractLastExchangeErrorMessage({ slWarnings: null, tpWarnings: 'TP2:REJECTED_BY_EXCHANGE' });
    expect(msg).toBe('TP2:REJECTED_BY_EXCHANGE');
  });

  it('returns null when neither field has anything useful', () => {
    expect(extractLastExchangeErrorMessage({ slWarnings: null, tpWarnings: null })).toBeNull();
    expect(extractLastExchangeErrorMessage({})).toBeNull();
  });
});
