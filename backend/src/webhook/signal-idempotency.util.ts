export function buildSignalIdempotencyKey(params: {
  strategyId: string;
  symbol: string;
  action: string;
  barTime?: string | null;
}): string {
  return `${params.strategyId}:${params.symbol}:${params.action}:${params.barTime ?? ''}`;
}

export function isWithinIdempotencyWindow(lastProcessedAt: number | undefined, now: number, windowMs: number): boolean {
  if (lastProcessedAt === undefined) return false;
  return now - lastProcessedAt < windowMs;
}
