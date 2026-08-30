export const TP_MISSING_RETRY_LIMIT = 3;

const RETRY_TOKEN_PREFIX = 'TP_MISSING_RETRY:';

function splitWarnings(tpWarnings: string | null | undefined): string[] {
  return (tpWarnings || '').split(';').filter(Boolean);
}

export function parseTpMissingRetryCount(tpWarnings: string | null | undefined): number {
  const token = splitWarnings(tpWarnings).find((t) => t.startsWith(RETRY_TOKEN_PREFIX));
  if (!token) return 0;
  const n = parseInt(token.slice(RETRY_TOKEN_PREFIX.length), 10);
  return Number.isNaN(n) ? 0 : n;
}

export function incrementTpMissingRetry(tpWarnings: string | null | undefined): string {
  const next = parseTpMissingRetryCount(tpWarnings) + 1;
  const otherParts = splitWarnings(tpWarnings).filter((t) => !t.startsWith(RETRY_TOKEN_PREFIX));
  return [...otherParts, `${RETRY_TOKEN_PREFIX}${next}`].join(';');
}

export function clearTpMissingRetry(tpWarnings: string | null | undefined): string | null {
  const otherParts = splitWarnings(tpWarnings).filter((t) => !t.startsWith(RETRY_TOKEN_PREFIX));
  return otherParts.length > 0 ? otherParts.join(';') : null;
}

export function shouldFallbackToMarket(tpWarnings: string | null | undefined): boolean {
  return parseTpMissingRetryCount(tpWarnings) >= TP_MISSING_RETRY_LIMIT;
}

export function computeTargetVsExecutedDiffPct(targetPrice: number, executedPrice: number): number {
  if (!targetPrice) return 0;
  return ((executedPrice - targetPrice) / targetPrice) * 100;
}
