export interface BybitOrderInfoLike {
  avgPrice?: string | null;
}

export interface BybitPositionLike {
  side: string;
  size: string;
  avgPrice: string;
}

export interface ResolveBybitActualFillPriceDeps {
  getOrderInfo: () => Promise<BybitOrderInfoLike | null>;
  getOrderHistory: () => Promise<BybitOrderInfoLike | null>;
  getPositions: () => Promise<BybitPositionLike[]>;
  side: 'Buy' | 'Sell';
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function resolveBybitActualFillPrice(deps: ResolveBybitActualFillPriceDeps): Promise<number | undefined> {
  const maxRetries = deps.maxRetries ?? 3;
  const retryDelayMs = deps.retryDelayMs ?? 300;
  const sleep = deps.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const orderInfo = await deps.getOrderInfo();
    const avgPrice = parseFloat(orderInfo?.avgPrice || '0');
    if (avgPrice > 0) {
      return avgPrice;
    }
    if (attempt < maxRetries) {
      await sleep(retryDelayMs);
    }
  }

  const historyInfo = await deps.getOrderHistory();
  const historyAvgPrice = parseFloat(historyInfo?.avgPrice || '0');
  if (historyAvgPrice > 0) {
    return historyAvgPrice;
  }

  const positions = await deps.getPositions();
  const position = positions.find(pos => pos.side === deps.side && parseFloat(pos.size || '0') > 0);
  const positionAvgPrice = parseFloat(position?.avgPrice || '0');
  return positionAvgPrice > 0 ? positionAvgPrice : undefined;
}
