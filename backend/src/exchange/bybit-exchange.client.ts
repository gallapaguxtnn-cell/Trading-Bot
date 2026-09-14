import { Injectable } from '@nestjs/common';
import { BybitClientService } from './bybit-client.service';
import {
  AccountContext,
  CreateOrderParams,
  ExchangeClient,
  NeutralPositionMode,
  NeutralSide,
  OrderInfo,
  OrderResult,
  PositionInfo,
  SymbolRules,
} from './exchange-client.interface';

function toBybitSide(side: NeutralSide): 'Buy' | 'Sell' {
  return side === 'BUY' ? 'Buy' : 'Sell';
}

function fromBybitSide(side: string): NeutralSide | 'NONE' {
  if (side === 'Buy') return 'BUY';
  if (side === 'Sell') return 'SELL';
  return 'NONE';
}

@Injectable()
export class BybitExchangeClient implements ExchangeClient {
  constructor(private readonly bybit: BybitClientService) {}

  async createOrder(ctx: AccountContext, params: CreateOrderParams): Promise<OrderResult> {
    const result = await this.bybit.createOrder(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', {
      symbol: params.symbol,
      side: toBybitSide(params.side),
      orderType: params.orderType === 'MARKET' ? 'Market' : 'Limit',
      qty: params.qty,
      price: params.price,
      reduceOnly: params.reduceOnly,
      hedgeMode: params.hedgeMode,
    }, ctx.region);
    return { orderId: result.orderId, orderLinkId: result.orderLinkId };
  }

  async cancelOrder(ctx: AccountContext, symbol: string, orderId: string): Promise<boolean> {
    return this.bybit.cancelOrder(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, orderId, ctx.region);
  }

  async cancelAllOrders(ctx: AccountContext, symbol: string): Promise<boolean> {
    return this.bybit.cancelAllOrders(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, ctx.region);
  }

  async getOpenOrders(ctx: AccountContext, symbol?: string): Promise<OrderInfo[]> {
    const orders = await this.bybit.getOpenOrders(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, ctx.region);
    return orders as OrderInfo[];
  }

  async getOrderInfo(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null> {
    const info = await this.bybit.getOrderInfo(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, orderId, ctx.region);
    return info as OrderInfo | null;
  }

  async getOrderHistory(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null> {
    const info = await this.bybit.getOrderHistory(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, orderId, ctx.region);
    return info as OrderInfo | null;
  }

  async createStopLossOrder(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    qty: string,
    triggerPrice: string,
    hedgeMode?: boolean,
  ): Promise<OrderResult> {
    const result = await this.bybit.createStopLossOrder(
      ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO',
      symbol, toBybitSide(side), qty, triggerPrice, hedgeMode, ctx.region,
    );
    return { orderId: result.orderId, orderLinkId: result.orderLinkId };
  }

  async setTradingStop(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    stopLoss?: string,
    takeProfit?: string,
    hedgeMode?: boolean,
  ): Promise<boolean> {
    return this.bybit.setTradingStop(
      ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO',
      symbol, toBybitSide(side), stopLoss, takeProfit, hedgeMode, ctx.region,
    );
  }

  async clearTradingStop(ctx: AccountContext, symbol: string, side: NeutralSide, hedgeMode?: boolean): Promise<boolean> {
    return this.bybit.clearTradingStop(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, toBybitSide(side), hedgeMode, ctx.region);
  }

  async getPositions(ctx: AccountContext, symbol?: string): Promise<PositionInfo[]> {
    const positions = await this.bybit.getPositions(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, ctx.region);
    return positions.map((p) => ({
      symbol: p.symbol,
      side: fromBybitSide(p.side),
      size: p.size,
      avgPrice: p.avgPrice,
      unrealizedPnl: p.unrealisedPnl,
      leverage: p.leverage,
      markPrice: p.markPrice,
      liqPrice: p.liqPrice,
      positionValue: p.positionValue,
    }));
  }

  async detectPositionMode(ctx: AccountContext, symbol: string): Promise<NeutralPositionMode | null> {
    return this.bybit.detectPositionMode(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, ctx.region);
  }

  async getPositionIdx(ctx: AccountContext, symbol: string, side: NeutralSide, hedgeMode?: boolean): Promise<number> {
    return this.bybit.getPositionIdx(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, toBybitSide(side), hedgeMode, ctx.region);
  }

  async waitForPosition(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    maxRetries?: number,
    delayMs?: number,
    hedgeMode?: boolean,
  ): Promise<boolean> {
    return this.bybit.waitForPosition(
      ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO',
      symbol, toBybitSide(side), maxRetries, delayMs, hedgeMode, ctx.region,
    );
  }

  async setLeverage(ctx: AccountContext, symbol: string, leverage: number): Promise<void> {
    return this.bybit.setLeverage(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, leverage, ctx.region);
  }

  async setMarginMode(ctx: AccountContext, symbol: string, marginMode: 'ISOLATED' | 'CROSS', leverage: number): Promise<void> {
    return this.bybit.setMarginMode(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, marginMode, leverage, ctx.region);
  }

  async getWalletBalance(ctx: AccountContext): Promise<number> {
    return this.bybit.getWalletBalance(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', ctx.region);
  }

  async getCurrentPrice(ctx: AccountContext, symbol: string): Promise<number> {
    return this.bybit.getCurrentPrice(ctx.mode === 'DEMO', symbol);
  }

  async getLastTradePrice(ctx: AccountContext, symbol: string): Promise<number | null> {
    return this.bybit.getLastTradePrice(ctx.credentials.apiKey, ctx.credentials.apiSecret, ctx.mode === 'DEMO', symbol, ctx.region);
  }

  async getSymbolRules(ctx: AccountContext, symbol: string): Promise<SymbolRules> {
    return this.bybit.getSymbolRules(ctx.mode === 'DEMO', symbol);
  }

  async getServerTime(ctx: AccountContext): Promise<number> {
    return this.bybit.getServerTime(ctx.mode === 'DEMO');
  }
}
