export const POSITION_CHECK_RETRY_LIMIT = 3;

export type PositionCheckResult = 'LIVE' | 'NOT_FOUND' | 'CHECK_FAILED';

export function shouldEscalateToReconciliation(nextFailureCount: number): boolean {
  return nextFailureCount >= POSITION_CHECK_RETRY_LIMIT;
}
