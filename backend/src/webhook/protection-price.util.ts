export interface ProtectionPriceInput {
  isLimitOrder: boolean;
  hasBuffer: boolean;
  isAveragingTrade: boolean;
  actualEntryPrice: number | undefined;
  signalPrice: number;
}

export interface ProtectionPriceResult {
  price: number;
  usedActualFill: boolean;
}

export function resolveProtectionPrice(input: ProtectionPriceInput): ProtectionPriceResult {
  const { actualEntryPrice, isAveragingTrade, signalPrice } = input;
  if (actualEntryPrice && !isAveragingTrade) {
    return { price: actualEntryPrice, usedActualFill: true };
  }
  return { price: signalPrice, usedActualFill: false };
}

export interface FinalEntryPriceInput {
  isLimitOrder: boolean;
  actualEntryPrice: number | undefined;
  fallbackPrice: number | undefined;
}

export function resolveFinalEntryPrice(input: FinalEntryPriceInput): number | undefined {
  const { isLimitOrder, actualEntryPrice, fallbackPrice } = input;
  return (!isLimitOrder && actualEntryPrice) ? actualEntryPrice : fallbackPrice;
}
