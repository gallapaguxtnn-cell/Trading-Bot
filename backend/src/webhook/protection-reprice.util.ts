export interface RepriceCheckInput {
  currentPrice: number | null | undefined;
  targetPrice: number;
  tolerancePercent?: number;
}

export interface RepriceCheckResult {
  shouldReprice: boolean;
  diffPercent: number | null;
}

export function shouldRepriceProtection(input: RepriceCheckInput): RepriceCheckResult {
  const { currentPrice, targetPrice, tolerancePercent = 0.05 } = input;
  if (currentPrice === null || currentPrice === undefined || !isFinite(currentPrice) || currentPrice <= 0) {
    return { shouldReprice: false, diffPercent: null };
  }
  if (!isFinite(targetPrice) || targetPrice <= 0) {
    return { shouldReprice: false, diffPercent: null };
  }
  const diffPercent = (Math.abs(currentPrice - targetPrice) / targetPrice) * 100;
  return { shouldReprice: diffPercent > tolerancePercent, diffPercent };
}
