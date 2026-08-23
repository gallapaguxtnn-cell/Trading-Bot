export interface GroupableTrade {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number | string;
  timestamp: string;
}

export interface TradeGroup<T extends GroupableTrade> {
  primary: T;
  fragments: T[];
}

const ENTRY_PRICE_TOLERANCE_RATIO = 0.001;
const GROUPING_WINDOW_MS = 24 * 60 * 60 * 1000;

function toNumber(value: number | string): number {
  return typeof value === 'string' ? parseFloat(value) : value;
}

function sameEntryPrice(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / a <= ENTRY_PRICE_TOLERANCE_RATIO;
}

export function groupTradesByPosition<T extends GroupableTrade>(trades: T[]): TradeGroup<T>[] {
  const groups: TradeGroup<T>[] = [];

  for (const trade of trades) {
    const entryPrice = toNumber(trade.entryPrice);
    const tradeTime = new Date(trade.timestamp).getTime();

    const existingGroup = groups.find(group => {
      if (group.primary.symbol !== trade.symbol || group.primary.side !== trade.side) return false;
      if (!sameEntryPrice(entryPrice, toNumber(group.primary.entryPrice))) return false;
      const primaryTime = new Date(group.primary.timestamp).getTime();
      return Math.abs(tradeTime - primaryTime) <= GROUPING_WINDOW_MS;
    });

    if (!existingGroup) {
      groups.push({ primary: trade, fragments: [] });
      continue;
    }

    const allMembers = [...existingGroup.fragments, existingGroup.primary, trade];
    const earliest = allMembers.reduce((oldest, candidate) =>
      new Date(candidate.timestamp).getTime() < new Date(oldest.timestamp).getTime() ? candidate : oldest
    );
    existingGroup.primary = earliest;
    existingGroup.fragments = allMembers.filter(member => member.id !== earliest.id);
  }

  return groups;
}
