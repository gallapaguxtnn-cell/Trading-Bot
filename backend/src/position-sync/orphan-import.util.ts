export interface RecentClosedTradeCandidate {
  id: string;
  entryPrice: number;
}

export function findResidualTradeMatch(
  candidates: RecentClosedTradeCandidate[],
  positionEntryPrice: number,
  toleranceRatio: number = 0.001,
): RecentClosedTradeCandidate | null {
  for (const candidate of candidates) {
    if (candidate.entryPrice <= 0) continue;
    const deviation = Math.abs(candidate.entryPrice - positionEntryPrice) / candidate.entryPrice;
    if (deviation <= toleranceRatio) {
      return candidate;
    }
  }
  return null;
}

export function isDustByNotional(size: number, markPrice: number, minNotionalUsdt: number): boolean {
  return size * markPrice < minNotionalUsdt;
}
