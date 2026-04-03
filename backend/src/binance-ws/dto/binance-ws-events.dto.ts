export class OrderUpdateEvent {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  status: string;
  executedQty: number;
  avgPrice: number;
  updateTime: number;
  positionSide?: string;
}

export class AccountUpdateEvent {
  updateTime: number;
  positions: PositionUpdate[];
  balances: BalanceUpdate[];
}

export class PositionUpdate {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'BOTH';
  positionAmount: number;
  entryPrice: number;
  unrealizedProfit: number;
  marginType: string;
}

export class BalanceUpdate {
  asset: string;
  walletBalance: number;
  crossWalletBalance: number;
  balanceChange: number;
}

export class PriceUpdateEvent {
  symbol: string;
  price: number;
  timestamp: number;
}
