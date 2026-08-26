export interface TrackedTpOrder {
  level: number;
  orderId: string;
}

export function parseTrackedTpOrders(takeProfitOrderId: string | null | undefined): TrackedTpOrder[] {
  if (!takeProfitOrderId) return [];
  return takeProfitOrderId
    .split('|')
    .filter(Boolean)
    .map((entry) => {
      const [levelStr, orderId] = entry.split(':');
      return { level: parseInt(levelStr, 10), orderId };
    })
    .filter((e) => !Number.isNaN(e.level) && !!e.orderId);
}

export function computeExpectedTpLevels(enabledTpIds: number[], lastTpLevel: number): number[] {
  return enabledTpIds.filter((id) => id > lastTpLevel);
}

export function countLiveTrackedOrders(tracked: TrackedTpOrder[], liveOrderIds: Set<string>): number {
  return tracked.filter((t) => liveOrderIds.has(t.orderId)).length;
}
