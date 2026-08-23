export interface ClosedTradeForDuplicateCheck {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  closedAt: Date | string;
  pnl: number | null;
}

export interface DuplicatePositionGroup {
  trades: ClosedTradeForDuplicateCheck[];
}

const ENTRY_PRICE_TOLERANCE_RATIO = 0.001;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function findDuplicatePositionGroups(trades: ClosedTradeForDuplicateCheck[]): DuplicatePositionGroup[] {
  const bySymbolSide = new Map<string, ClosedTradeForDuplicateCheck[]>();
  for (const trade of trades) {
    const key = `${trade.symbol}:${trade.side}`;
    if (!bySymbolSide.has(key)) bySymbolSide.set(key, []);
    bySymbolSide.get(key)!.push(trade);
  }

  const result: DuplicatePositionGroup[] = [];

  for (const symbolSideTrades of bySymbolSide.values()) {
    const groups: ClosedTradeForDuplicateCheck[][] = [];

    for (const trade of symbolSideTrades) {
      if (trade.entryPrice <= 0 || !trade.closedAt) continue;
      const tradeTime = new Date(trade.closedAt).getTime();

      const matchGroup = groups.find(group =>
        group.some(member => {
          const deviation = Math.abs(member.entryPrice - trade.entryPrice) / member.entryPrice;
          if (deviation > ENTRY_PRICE_TOLERANCE_RATIO) return false;
          const memberTime = new Date(member.closedAt).getTime();
          return Math.abs(memberTime - tradeTime) <= DUPLICATE_WINDOW_MS;
        })
      );

      if (matchGroup) {
        matchGroup.push(trade);
      } else {
        groups.push([trade]);
      }
    }

    for (const group of groups) {
      if (group.length >= 2) {
        result.push({ trades: group });
      }
    }
  }

  return result;
}
