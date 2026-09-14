export type AccountMode = 'DEMO' | 'REAL';

export type AccountRegion = null | 'BRA_BTL' | 'ARG_BTL' | 'EL_SALVADOR' | 'EEA' | 'US';

export interface AccountCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
}

export interface AccountContext {
  credentials: AccountCredentials;
  mode: AccountMode;
  region: AccountRegion;
}

export type NeutralSide = 'BUY' | 'SELL';
export type NeutralOrderType = 'MARKET' | 'LIMIT';
export type NeutralMarginMode = 'ISOLATED' | 'CROSS';
export type NeutralPositionMode = 'HEDGE' | 'ONE_WAY';

export interface CreateOrderParams {
  symbol: string;
  side: NeutralSide;
  orderType: NeutralOrderType;
  qty: string;
  price?: string;
  reduceOnly?: boolean;
  hedgeMode?: boolean;
}

export interface OrderResult {
  orderId: string;
  orderLinkId?: string;
}

export interface PositionInfo {
  symbol: string;
  side: NeutralSide | 'NONE';
  size: string;
  avgPrice: string;
  unrealizedPnl: string;
  leverage: string;
  markPrice: string;
  liqPrice?: string;
  positionValue?: string;
}

export interface OrderInfo {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  price: string;
  qty: string;
  orderStatus: string;
  avgPrice: string;
  cumExecQty: string;
  cumExecFee?: string;
  updatedTime?: string;
}

export interface SymbolRules {
  qtyStep: string;
  priceTick: string;
  minQty: string;
  minNotional: string;
}

export interface ExchangeClient {
  createOrder(ctx: AccountContext, params: CreateOrderParams): Promise<OrderResult>;

  cancelOrder(ctx: AccountContext, symbol: string, orderId: string): Promise<boolean>;

  cancelAllOrders(ctx: AccountContext, symbol: string): Promise<boolean>;

  getOpenOrders(ctx: AccountContext, symbol?: string): Promise<OrderInfo[]>;

  getOrderInfo(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null>;

  getOrderHistory(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null>;

  createStopLossOrder(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    qty: string,
    triggerPrice: string,
    hedgeMode?: boolean,
  ): Promise<OrderResult>;

  setTradingStop(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    stopLoss?: string,
    takeProfit?: string,
    hedgeMode?: boolean,
  ): Promise<boolean>;

  clearTradingStop(ctx: AccountContext, symbol: string, side: NeutralSide, hedgeMode?: boolean): Promise<boolean>;

  getPositions(ctx: AccountContext, symbol?: string): Promise<PositionInfo[]>;

  detectPositionMode(ctx: AccountContext, symbol: string): Promise<NeutralPositionMode | null>;

  getPositionIdx(ctx: AccountContext, symbol: string, side: NeutralSide, hedgeMode?: boolean): Promise<number>;

  waitForPosition(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    maxRetries?: number,
    delayMs?: number,
    hedgeMode?: boolean,
  ): Promise<boolean>;

  setLeverage(ctx: AccountContext, symbol: string, leverage: number): Promise<void>;

  setMarginMode(ctx: AccountContext, symbol: string, marginMode: NeutralMarginMode, leverage: number): Promise<void>;

  getWalletBalance(ctx: AccountContext): Promise<number>;

  getCurrentPrice(ctx: AccountContext, symbol: string): Promise<number>;

  getLastTradePrice(ctx: AccountContext, symbol: string): Promise<number | null>;

  getSymbolRules(ctx: AccountContext, symbol: string): Promise<SymbolRules>;

  getServerTime(ctx: AccountContext): Promise<number>;
}
