export type LimitSyncAction = 'keep' | 'protect' | 'none';

export function decideLimitSyncAction(params: {
  orderStatus: string | null | undefined;
  hasProtection: boolean;
}): LimitSyncAction {
  const status = (params.orderStatus || '').toLowerCase();
  const isPending = status === 'new' || status === 'partiallyfilled' || status === 'partially_filled';
  const isFilled = status === 'filled';
  if (isFilled) return params.hasProtection ? 'none' : 'protect';
  if (isPending) return 'keep';
  return 'none';
}

export function shouldCancelPendingForStrategy(
  strategy: { isActive?: boolean; pauseNewOrders?: boolean } | null | undefined,
): boolean {
  if (!strategy) return true;
  return !strategy.isActive || !!strategy.pauseNewOrders;
}
