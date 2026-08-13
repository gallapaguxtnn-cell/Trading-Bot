export const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

const NUMERIC_TF: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '1440': '1d',
};

export function normalizeTimeframe(tf: string | null | undefined): string | null {
  if (tf == null) return null;
  const raw = String(tf).trim();
  if (raw === '') return null;
  if (TF_MS[raw]) return raw;
  const lower = raw.toLowerCase();
  if (TF_MS[lower]) return lower;
  if (NUMERIC_TF[raw]) return NUMERIC_TF[raw];
  if (lower === 'd' || lower === '1d') return '1d';
  return null;
}

export function resolveTimeframe(
  signalTimeframe: string | null | undefined,
  strategyTimeframe: string | null | undefined,
): string | null {
  return normalizeTimeframe(signalTimeframe) ?? normalizeTimeframe(strategyTimeframe);
}

export function computeBufferExpiry(receivedAt: Date, timeframe: string, candles = 1): Date | null {
  const tfMs = TF_MS[timeframe];
  if (!tfMs) return null;
  const n = Number.isFinite(candles) && candles >= 1 ? Math.floor(candles) : 1;
  const base = Math.ceil(receivedAt.getTime() / tfMs) * tfMs;
  return new Date(base + (n - 1) * tfMs);
}

export function fillMonitorAttempts(
  pendingExpiresAt: Date | number | null | undefined,
  now: number,
  delayMs = 10_000,
  defaultMs = 300_000,
  maxAheadMs = 26 * 60 * 60 * 1000,
): number {
  const cap = now + maxAheadMs;
  let deadline =
    pendingExpiresAt == null
      ? now + defaultMs
      : pendingExpiresAt instanceof Date
        ? pendingExpiresAt.getTime()
        : Number(pendingExpiresAt);
  if (!Number.isFinite(deadline)) deadline = now + defaultMs;
  if (deadline > cap) deadline = cap;
  return Math.max(1, Math.ceil((deadline - now) / delayMs));
}
