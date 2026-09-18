export const SL_MISSING_RETRY_LIMIT = 3;

const RETRY_TOKEN_PREFIX = 'SL_MISSING_RETRY:';

function splitWarnings(slWarnings: string | null | undefined): string[] {
  return (slWarnings || '').split(';').filter(Boolean);
}

export function parseSlMissingRetryCount(slWarnings: string | null | undefined): number {
  const token = splitWarnings(slWarnings).find((t) => t.startsWith(RETRY_TOKEN_PREFIX));
  if (!token) return 0;
  const n = parseInt(token.slice(RETRY_TOKEN_PREFIX.length), 10);
  return Number.isNaN(n) ? 0 : n;
}

export function incrementSlMissingRetry(slWarnings: string | null | undefined): string {
  const next = parseSlMissingRetryCount(slWarnings) + 1;
  const otherParts = splitWarnings(slWarnings).filter((t) => !t.startsWith(RETRY_TOKEN_PREFIX));
  return [...otherParts, `${RETRY_TOKEN_PREFIX}${next}`].join(';');
}

export function clearSlMissingRetry(slWarnings: string | null | undefined): string | null {
  const otherParts = splitWarnings(slWarnings).filter((t) => !t.startsWith(RETRY_TOKEN_PREFIX));
  return otherParts.length > 0 ? otherParts.join(';') : null;
}

export function shouldFallbackToMarketSl(slWarnings: string | null | undefined): boolean {
  return parseSlMissingRetryCount(slWarnings) >= SL_MISSING_RETRY_LIMIT;
}

export function computeSlTargetVsExecutedDiffPct(targetPrice: number, executedPrice: number): number {
  if (!targetPrice) return 0;
  return ((executedPrice - targetPrice) / targetPrice) * 100;
}

export function formatSlFallbackCloseDetail(targetPrice: number): string {
  return `TARGET:${targetPrice}`;
}
