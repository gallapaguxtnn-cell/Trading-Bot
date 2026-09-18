const FALLBACK_CLOSE_REASONS = new Set(['TAKE_PROFIT_FALLBACK_MARKET', 'STOP_LOSS_FALLBACK_MARKET']);

export function isProtectionFallbackClose(closeReason: string | null | undefined): boolean {
  return !!closeReason && FALLBACK_CLOSE_REASONS.has(closeReason);
}

export function isConsecutiveProtectionFallback(
  currentCloseReason: string | null | undefined,
  previousCloseReason: string | null | undefined,
): boolean {
  return isProtectionFallbackClose(currentCloseReason) && isProtectionFallbackClose(previousCloseReason);
}

export function extractLastExchangeErrorMessage(trade: {
  slWarnings?: string | null;
  tpWarnings?: string | null;
}): string | null {
  const slReason = (trade.slWarnings || '')
    .split(';')
    .filter(Boolean)
    .find((token) => token.startsWith('SL_CREATION_FAILED:'));
  if (slReason) return slReason.slice('SL_CREATION_FAILED:'.length);

  if (trade.tpWarnings) return trade.tpWarnings;

  return null;
}
