export function isPendingLimitEntry(trade: {
  type?: string | null;
  stopLossOrderId?: string | null;
  takeProfitOrderId?: string | null;
}): boolean {
  if (!trade || trade.type !== 'LIMIT') return false;
  return !trade.stopLossOrderId && !trade.takeProfitOrderId;
}
