import {
  parseTpMissingRetryCount,
  incrementTpMissingRetry,
  clearTpMissingRetry,
  shouldFallbackToMarket,
  computeTargetVsExecutedDiffPct,
  TP_MISSING_RETRY_LIMIT,
} from './take-profit-fallback.util';

describe('parseTpMissingRetryCount', () => {
  it('returns 0 when there is no retry token', () => {
    expect(parseTpMissingRetryCount(null)).toBe(0);
    expect(parseTpMissingRetryCount(undefined)).toBe(0);
    expect(parseTpMissingRetryCount('')).toBe(0);
    expect(parseTpMissingRetryCount('TP2:BELOW_MIN_NOTIONAL')).toBe(0);
  });

  it('reads the retry count from the token, ignoring other warnings', () => {
    expect(parseTpMissingRetryCount('TP2:BELOW_MIN_NOTIONAL;TP_MISSING_RETRY:2')).toBe(2);
    expect(parseTpMissingRetryCount('TP_MISSING_RETRY:1')).toBe(1);
  });
});

describe('incrementTpMissingRetry', () => {
  it('starts a counter at 1 when there was none before', () => {
    expect(incrementTpMissingRetry(null)).toBe('TP_MISSING_RETRY:1');
  });

  it('increments an existing counter without duplicating the token', () => {
    expect(incrementTpMissingRetry('TP_MISSING_RETRY:1')).toBe('TP_MISSING_RETRY:2');
    expect(incrementTpMissingRetry('TP_MISSING_RETRY:2')).toBe('TP_MISSING_RETRY:3');
  });

  it('preserves other warning tokens already present', () => {
    expect(incrementTpMissingRetry('TP2:BELOW_MIN_NOTIONAL;TP_MISSING_RETRY:1')).toBe(
      'TP2:BELOW_MIN_NOTIONAL;TP_MISSING_RETRY:2',
    );
  });
});

describe('clearTpMissingRetry', () => {
  it('removes only the retry token, keeping other warnings', () => {
    expect(clearTpMissingRetry('TP2:BELOW_MIN_NOTIONAL;TP_MISSING_RETRY:3')).toBe('TP2:BELOW_MIN_NOTIONAL');
  });

  it('returns null when nothing is left after removing the retry token', () => {
    expect(clearTpMissingRetry('TP_MISSING_RETRY:3')).toBeNull();
    expect(clearTpMissingRetry(null)).toBeNull();
  });
});

describe('shouldFallbackToMarket', () => {
  it('is false below the retry limit', () => {
    expect(shouldFallbackToMarket(null)).toBe(false);
    expect(shouldFallbackToMarket('TP_MISSING_RETRY:1')).toBe(false);
    expect(shouldFallbackToMarket(`TP_MISSING_RETRY:${TP_MISSING_RETRY_LIMIT - 1}`)).toBe(false);
  });

  it('is true once the retry limit is reached', () => {
    expect(shouldFallbackToMarket(`TP_MISSING_RETRY:${TP_MISSING_RETRY_LIMIT}`)).toBe(true);
    expect(shouldFallbackToMarket(`TP_MISSING_RETRY:${TP_MISSING_RETRY_LIMIT + 5}`)).toBe(true);
  });
});

describe('computeTargetVsExecutedDiffPct', () => {
  it('matches the reported SUIUSDT SHORT incident: target 0.75234, executed 0.7535 (~0.154% off, worse than target)', () => {
    const diff = computeTargetVsExecutedDiffPct(0.75234, 0.7535);
    expect(diff).toBeCloseTo(0.1541, 3);
  });

  it('returns 0 when the target price is 0 (avoids divide-by-zero)', () => {
    expect(computeTargetVsExecutedDiffPct(0, 100)).toBe(0);
  });
});
