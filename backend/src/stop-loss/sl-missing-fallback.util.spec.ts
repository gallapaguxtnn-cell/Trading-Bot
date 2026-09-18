import {
  parseSlMissingRetryCount,
  incrementSlMissingRetry,
  clearSlMissingRetry,
  shouldFallbackToMarketSl,
  computeSlTargetVsExecutedDiffPct,
  formatSlFallbackCloseDetail,
  SL_MISSING_RETRY_LIMIT,
} from './sl-missing-fallback.util';

describe('parseSlMissingRetryCount', () => {
  it('returns 0 when there is no retry token', () => {
    expect(parseSlMissingRetryCount(null)).toBe(0);
    expect(parseSlMissingRetryCount(undefined)).toBe(0);
    expect(parseSlMissingRetryCount('')).toBe(0);
    expect(parseSlMissingRetryCount('SL_CREATION_FAILED:timeout')).toBe(0);
  });

  it('reads the retry count from the token, ignoring the FASE 1 SL_CREATION_FAILED token', () => {
    expect(parseSlMissingRetryCount('SL_CREATION_FAILED:timeout;SL_MISSING_RETRY:2')).toBe(2);
    expect(parseSlMissingRetryCount('SL_MISSING_RETRY:1')).toBe(1);
  });
});

describe('incrementSlMissingRetry', () => {
  it('starts a counter at 1 when there was none before', () => {
    expect(incrementSlMissingRetry(null)).toBe('SL_MISSING_RETRY:1');
  });

  it('increments an existing counter without duplicating the token', () => {
    expect(incrementSlMissingRetry('SL_MISSING_RETRY:1')).toBe('SL_MISSING_RETRY:2');
    expect(incrementSlMissingRetry('SL_MISSING_RETRY:2')).toBe('SL_MISSING_RETRY:3');
  });

  it('preserves the FASE 1 SL_CREATION_FAILED token already present (coexistem no mesmo campo)', () => {
    expect(incrementSlMissingRetry('SL_CREATION_FAILED:timeout;SL_MISSING_RETRY:1')).toBe(
      'SL_CREATION_FAILED:timeout;SL_MISSING_RETRY:2',
    );
  });
});

describe('clearSlMissingRetry', () => {
  it('removes only the retry token, keeping the SL_CREATION_FAILED reason', () => {
    expect(clearSlMissingRetry('SL_CREATION_FAILED:timeout;SL_MISSING_RETRY:3')).toBe('SL_CREATION_FAILED:timeout');
  });

  it('returns null when nothing is left after removing the retry token', () => {
    expect(clearSlMissingRetry('SL_MISSING_RETRY:3')).toBeNull();
    expect(clearSlMissingRetry(null)).toBeNull();
  });
});

describe('shouldFallbackToMarketSl', () => {
  it('is false below the retry limit', () => {
    expect(shouldFallbackToMarketSl(null)).toBe(false);
    expect(shouldFallbackToMarketSl('SL_MISSING_RETRY:1')).toBe(false);
    expect(shouldFallbackToMarketSl(`SL_MISSING_RETRY:${SL_MISSING_RETRY_LIMIT - 1}`)).toBe(false);
  });

  it('is true once the retry limit is reached', () => {
    expect(shouldFallbackToMarketSl(`SL_MISSING_RETRY:${SL_MISSING_RETRY_LIMIT}`)).toBe(true);
    expect(shouldFallbackToMarketSl(`SL_MISSING_RETRY:${SL_MISSING_RETRY_LIMIT + 5}`)).toBe(true);
  });
});

describe('computeSlTargetVsExecutedDiffPct', () => {
  it('reproduz o caso real DOGEUSDT: alvo 0.0827243 (0,50% configurado), executado 0.08228 (~0,53% pior)', () => {
    const diff = computeSlTargetVsExecutedDiffPct(0.0827243, 0.08228);
    expect(diff).toBeCloseTo(-0.5371, 3);
  });

  it('returns 0 when the target price is 0 (avoids divide-by-zero)', () => {
    expect(computeSlTargetVsExecutedDiffPct(0, 100)).toBe(0);
  });
});

describe('formatSlFallbackCloseDetail', () => {
  it('formats the target price the same way the TP fallback does', () => {
    expect(formatSlFallbackCloseDetail(0.0827243)).toBe('TARGET:0.0827243');
  });
});
