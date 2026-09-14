import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { Exchange } from '../strategies/strategy.entity';
import {
  normalizeQuantity,
  roundPriceToTick,
} from '../common/exchange-precision.util';
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

const BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
const BINANCE_MAINNET_URL = 'https://fapi.binance.com';

function baseUrl(ctx: AccountContext): string {
  return ctx.mode === 'DEMO' ? BINANCE_TESTNET_URL : BINANCE_MAINNET_URL;
}

function sign(apiSecret: string, queryString: string): string {
  return crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');
}

function headers(apiKey: string): Record<string, string> {
  return { 'X-MBX-APIKEY': apiKey };
}

function formHeaders(apiKey: string): Record<string, string> {
  return {
    'X-MBX-APIKEY': apiKey,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

function toBinanceSide(side: NeutralSide): 'BUY' | 'SELL' {
  return side;
}

@Injectable()
export class BinanceClientService implements ExchangeClient {
  private readonly logger = new Logger(BinanceClientService.name);
  private readonly rateLimiter = RateLimiterUtil.getInstance();

  constructor(private readonly symbolRulesService: SymbolRulesService) {}

  private async signedGet(
    ctx: AccountContext,
    path: string,
    params: URLSearchParams,
  ) {
    params.append('timestamp', Date.now().toString());
    const queryString = params.toString();
    const signature = sign(ctx.credentials.apiSecret, queryString);
    return BinanceRequestUtil.get(
      `${baseUrl(ctx)}${path}?${queryString}&signature=${signature}`,
      {
        headers: headers(ctx.credentials.apiKey),
      },
    );
  }

  private async signedPost(
    ctx: AccountContext,
    path: string,
    params: URLSearchParams,
  ) {
    params.append('timestamp', Date.now().toString());
    const queryString = params.toString();
    const signature = sign(ctx.credentials.apiSecret, queryString);
    return BinanceRequestUtil.post(
      `${baseUrl(ctx)}${path}`,
      `${queryString}&signature=${signature}`,
      {
        headers: formHeaders(ctx.credentials.apiKey),
      },
    );
  }

  private async signedDelete(
    ctx: AccountContext,
    path: string,
    params: URLSearchParams,
  ) {
    params.append('timestamp', Date.now().toString());
    const queryString = params.toString();
    const signature = sign(ctx.credentials.apiSecret, queryString);
    return BinanceRequestUtil.delete(
      `${baseUrl(ctx)}${path}?${queryString}&signature=${signature}`,
      {
        headers: headers(ctx.credentials.apiKey),
      },
    );
  }

  async detectPositionMode(
    ctx: AccountContext,
    symbol: string,
  ): Promise<NeutralPositionMode | null> {
    const cacheKey = `posmode:${ctx.credentials.apiKey.substring(0, 8)}:${ctx.mode}`;
    const cached = this.rateLimiter.getCached<boolean>(cacheKey);
    if (cached !== null) {
      return cached ? 'HEDGE' : 'ONE_WAY';
    }

    try {
      const response = await this.signedGet(
        ctx,
        '/fapi/v1/positionSide/dual',
        new URLSearchParams(),
      );
      const hedge = response.data.dualSidePosition === true;
      this.rateLimiter.setCached(cacheKey, hedge, 1800000);
      return hedge ? 'HEDGE' : 'ONE_WAY';
    } catch (error: any) {
      this.logger.warn(
        `[BINANCE] Failed to detect position mode: ${error.message}`,
      );
      return null;
    }
  }

  async ensurePositionMode(
    ctx: AccountContext,
    symbol: string,
    hedgeMode: boolean,
  ): Promise<void> {
    if (process.env.BINANCE_SKIP_POSITION_CONFIG === 'true') return;

    const currentMode = await this.detectPositionMode(ctx, symbol);
    const currentHedge = currentMode === 'HEDGE';
    if (currentMode !== null && currentHedge === hedgeMode) return;

    try {
      const params = new URLSearchParams();
      params.append('dualSidePosition', String(hedgeMode));
      await this.signedPost(ctx, '/fapi/v1/positionSide/dual', params);
      this.rateLimiter.setCached(
        `posmode:${ctx.credentials.apiKey.substring(0, 8)}:${ctx.mode}`,
        hedgeMode,
        1800000,
      );
    } catch (error: any) {
      const errorCode = error.response?.data?.code;
      const errorMsg = error.response?.data?.msg;
      const isAlreadyConfigured =
        errorCode === -4300 ||
        (errorMsg &&
          String(errorMsg).toLowerCase().includes('no need to change'));

      if (isAlreadyConfigured) return;

      if (errorCode === -4059) {
        throw new Error(
          `Cannot change position mode while positions are open. Close all positions and try again. ` +
            `Strategy expects ${hedgeMode ? 'Hedge Mode' : 'One-Way Mode'} but account has open positions.`,
        );
      }

      this.logger.warn(
        `[BINANCE] Failed to set position mode: ${errorMsg || error.message}`,
      );
    }
  }

  async setMarginMode(
    ctx: AccountContext,
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSS',
    _leverage: number,
  ): Promise<void> {
    const cacheKey = `margin:${ctx.credentials.apiKey.substring(0, 8)}:${symbol}:${marginMode}:${ctx.mode}`;
    if (this.rateLimiter.getCached<boolean>(cacheKey)) return;

    try {
      const params = new URLSearchParams();
      params.append('symbol', symbol);
      params.append('marginType', marginMode);
      await this.signedPost(ctx, '/fapi/v1/marginType', params);
      this.rateLimiter.setCached(cacheKey, true, 1800000);
    } catch (error: any) {
      if (error.response?.data?.code === -4046) {
        this.rateLimiter.setCached(cacheKey, true, 1800000);
        return;
      }
      this.logger.warn(
        `[BINANCE] Failed to set margin mode: ${error.response?.data?.msg || error.message}`,
      );
    }
  }

  async setLeverage(
    ctx: AccountContext,
    symbol: string,
    leverage: number,
  ): Promise<void> {
    const cacheKey = `leverage:${ctx.credentials.apiKey.substring(0, 8)}:${symbol}:${leverage}:${ctx.mode}`;
    if (this.rateLimiter.getCached<boolean>(cacheKey)) return;

    try {
      const params = new URLSearchParams();
      params.append('symbol', symbol);
      params.append('leverage', String(leverage));
      await this.signedPost(ctx, '/fapi/v1/leverage', params);
      this.rateLimiter.setCached(cacheKey, true, 1800000);
    } catch (error: any) {
      this.logger.warn(
        `[BINANCE] Failed to set leverage: ${error.response?.data?.msg || error.message}`,
      );
    }
  }

  private async createRegularOrder(
    ctx: AccountContext,
    params: URLSearchParams,
  ): Promise<{ orderId: string | number; status?: string }> {
    const response = await this.signedPost(ctx, '/fapi/v1/order', params);
    return response.data;
  }

  private async createAlgoOrder(
    ctx: AccountContext,
    params: URLSearchParams,
  ): Promise<{ algoId: string | number }> {
    const response = await this.signedPost(ctx, '/fapi/v1/algoOrder', params);
    return response.data;
  }

  async createOrder(
    ctx: AccountContext,
    params: CreateOrderParams,
  ): Promise<OrderResult> {
    const orderParams = new URLSearchParams();
    orderParams.append('symbol', params.symbol);
    orderParams.append('side', toBinanceSide(params.side));
    orderParams.append(
      'type',
      params.orderType === 'MARKET' ? 'MARKET' : 'LIMIT',
    );
    orderParams.append('quantity', params.qty);

    if (params.orderType === 'LIMIT' && params.price) {
      orderParams.append('price', params.price);
      orderParams.append('timeInForce', 'GTC');
    }

    if (params.hedgeMode) {
      const positionSide = params.side === 'BUY' ? 'LONG' : 'SHORT';
      orderParams.append('positionSide', positionSide);
    } else if (params.reduceOnly) {
      orderParams.append('reduceOnly', 'true');
    }

    const result = await this.createRegularOrder(ctx, orderParams);
    return { orderId: String(result.orderId) };
  }

  async createStopLossOrder(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    qty: string,
    triggerPrice: string,
    hedgeMode?: boolean,
  ): Promise<OrderResult> {
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const rules = await this.symbolRulesService.getSymbolRules(
      symbol,
      ctx.mode === 'DEMO',
      Exchange.BINANCE,
    );
    const normalizedQty = normalizeQuantity(
      parseFloat(qty),
      rules.qtyStep,
      rules.minQty,
    );
    const normalizedTrigger = roundPriceToTick(
      parseFloat(triggerPrice),
      rules.priceTick,
    );

    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('side', closeSide);
    params.append('algoType', 'CONDITIONAL');
    params.append('type', 'STOP_MARKET');
    params.append('quantity', normalizedQty);
    params.append('triggerPrice', normalizedTrigger);
    params.append('workingType', 'MARK_PRICE');

    if (hedgeMode) {
      params.append('positionSide', side === 'BUY' ? 'LONG' : 'SHORT');
    } else {
      params.append('reduceOnly', 'true');
    }

    try {
      const result = await this.createAlgoOrder(ctx, params);
      return { orderId: String(result.algoId) };
    } catch (error: any) {
      const errorCode = error.response?.data?.code;
      if (errorCode === -4061 && hedgeMode) {
        params.delete('positionSide');
        params.set('reduceOnly', 'true');
        const retry = await this.createAlgoOrder(ctx, params);
        return { orderId: String(retry.algoId) };
      }
      throw error;
    }
  }

  setTradingStop(): Promise<boolean> {
    throw new Error(
      'setTradingStop nao e suportado pela Binance -- use createStopLossOrder',
    );
  }

  clearTradingStop(): Promise<boolean> {
    throw new Error(
      'clearTradingStop nao e suportado pela Binance -- cancele a ordem de SL diretamente',
    );
  }

  private async cancelRegularOrder(
    ctx: AccountContext,
    symbol: string,
    orderId: string,
  ): Promise<void> {
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('orderId', orderId);
    await this.signedDelete(ctx, '/fapi/v1/order', params);
  }

  private async cancelAlgoOrder(
    ctx: AccountContext,
    algoId: string,
  ): Promise<void> {
    const params = new URLSearchParams();
    params.append('algoId', algoId);
    await this.signedDelete(ctx, '/fapi/v1/algoOrder', params);
  }

  async cancelOrder(
    ctx: AccountContext,
    symbol: string,
    orderId: string,
  ): Promise<boolean> {
    try {
      await this.cancelAlgoOrder(ctx, orderId);
      return true;
    } catch (algoError: any) {
      const errorCode = algoError.response?.data?.code;
      if (errorCode === -4143 || errorCode === -1102) {
        try {
          await this.cancelRegularOrder(ctx, symbol, orderId);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async cancelAllOrders(ctx: AccountContext, symbol: string): Promise<boolean> {
    let ok = true;
    try {
      const params = new URLSearchParams();
      params.append('symbol', symbol);
      await this.signedDelete(ctx, '/fapi/v1/allOpenOrders', params);
    } catch (error: any) {
      ok = false;
      this.logger.warn(
        `[BINANCE] Failed to cancel open orders: ${error.response?.data?.msg || error.message}`,
      );
    }

    try {
      const algoOrdersResponse = await this.signedGet(
        ctx,
        '/fapi/v1/openAlgoOrders',
        new URLSearchParams({ symbol }),
      );
      for (const algoOrder of algoOrdersResponse.data) {
        try {
          await this.cancelAlgoOrder(ctx, String(algoOrder.algoId));
        } catch (e: any) {
          this.logger.warn(
            `[BINANCE] Failed to cancel algo order ${algoOrder.algoId}: ${e.message}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `[BINANCE] Failed to fetch/cancel algo orders: ${e.message}`,
      );
    }

    return ok;
  }

  async getOpenOrders(
    ctx: AccountContext,
    symbol?: string,
  ): Promise<OrderInfo[]> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    const response = await this.signedGet(ctx, '/fapi/v1/openOrders', params);
    return (response.data as any[]).map((o) => this.mapRegularOrder(o));
  }

  private mapRegularOrder(o: any): OrderInfo {
    return {
      orderId: String(o.orderId),
      symbol: o.symbol,
      side: o.side,
      orderType: o.type,
      price: o.price,
      qty: o.origQty,
      orderStatus: o.status,
      avgPrice: o.avgPrice,
      cumExecQty: o.executedQty,
      cumExecFee: undefined,
      updatedTime: o.updateTime ? String(o.updateTime) : undefined,
    };
  }

  private mapAlgoOrder(o: any): OrderInfo {
    return {
      orderId: String(o.algoId),
      symbol: o.symbol,
      side: o.side,
      orderType: o.type,
      price: o.triggerPrice,
      qty: o.origQty ?? o.quantity,
      orderStatus: o.algoStatus,
      avgPrice: o.avgPrice ?? '0',
      cumExecQty: o.executedQty ?? '0',
      cumExecFee: undefined,
      updatedTime: o.updateTime ? String(o.updateTime) : undefined,
    };
  }

  async getOrderInfo(
    ctx: AccountContext,
    symbol: string,
    orderId: string,
  ): Promise<OrderInfo | null> {
    try {
      const params = new URLSearchParams();
      params.append('algoId', orderId);
      const response = await this.signedGet(ctx, '/fapi/v1/algoOrder', params);
      return this.mapAlgoOrder(response.data);
    } catch (algoError: any) {
      const errorCode = algoError.response?.data?.code;
      if (errorCode === -4143 || errorCode === -1102 || errorCode === -2013) {
        try {
          const params = new URLSearchParams();
          params.append('symbol', symbol);
          params.append('orderId', orderId);
          const response = await this.signedGet(ctx, '/fapi/v1/order', params);
          return this.mapRegularOrder(response.data);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async getOrderHistory(
    ctx: AccountContext,
    symbol: string,
    orderId: string,
  ): Promise<OrderInfo | null> {
    return this.getOrderInfo(ctx, symbol, orderId);
  }

  async getPositions(
    ctx: AccountContext,
    symbol?: string,
  ): Promise<PositionInfo[]> {
    const params = new URLSearchParams();
    if (symbol) params.append('symbol', symbol);
    const response = await this.signedGet(ctx, '/fapi/v2/positionRisk', params);

    return (response.data as any[])
      .filter((p) => parseFloat(p.positionAmt) !== 0)
      .map((p) => {
        const posAmt = parseFloat(p.positionAmt);
        return {
          symbol: p.symbol,
          side: (posAmt > 0 ? 'BUY' : 'SELL') as NeutralSide,
          size: String(Math.abs(posAmt)),
          avgPrice: p.entryPrice,
          unrealizedPnl: p.unRealizedProfit,
          leverage: p.leverage,
          markPrice: p.markPrice,
        };
      });
  }

  getPositionIdx(): Promise<number> {
    return Promise.resolve(0);
  }

  async waitForPosition(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    maxRetries: number = 10,
    delayMs: number = 500,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const positions = await this.getPositions(ctx, symbol);
        const hasPosition = positions.some(
          (p) =>
            p.symbol === symbol && p.side === side && parseFloat(p.size) > 0,
        );
        if (hasPosition) return true;
      } catch (error: any) {
        this.logger.warn(
          `[BINANCE] Attempt ${attempt} to check position failed: ${error.message}`,
        );
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  async getWalletBalance(ctx: AccountContext): Promise<number> {
    const response = await this.signedGet(
      ctx,
      '/fapi/v2/balance',
      new URLSearchParams(),
    );
    const usdtBalance = (response.data as any[]).find(
      (b) => b.asset === 'USDT',
    );
    if (!usdtBalance) {
      throw new Error('USDT balance not found in account');
    }
    const availableBalance = parseFloat(usdtBalance.availableBalance || '0');
    const walletBalance = parseFloat(usdtBalance.balance || '0');
    return availableBalance > 0 ? availableBalance : walletBalance;
  }

  async getCurrentPrice(ctx: AccountContext, symbol: string): Promise<number> {
    try {
      const response = await BinanceRequestUtil.get(
        `${baseUrl(ctx)}/fapi/v1/ticker/price?symbol=${symbol}`,
      );
      return parseFloat(response.data.price);
    } catch (error: any) {
      this.logger.error(
        `[BINANCE] Failed to get current price: ${error.message}`,
      );
      return 0;
    }
  }

  async getLastTradePrice(
    ctx: AccountContext,
    symbol: string,
  ): Promise<number | null> {
    try {
      const params = new URLSearchParams();
      params.append('symbol', symbol);
      params.append('limit', '1');
      const response = await this.signedGet(ctx, '/fapi/v1/userTrades', params);
      if (response.data && response.data.length > 0) {
        return parseFloat(response.data[0].price);
      }
      return null;
    } catch {
      return null;
    }
  }

  async getSymbolRules(
    ctx: AccountContext,
    symbol: string,
  ): Promise<SymbolRules> {
    return this.symbolRulesService.getSymbolRules(
      symbol,
      ctx.mode === 'DEMO',
      Exchange.BINANCE,
    );
  }

  async getServerTime(ctx: AccountContext): Promise<number> {
    try {
      const response = await BinanceRequestUtil.get(
        `${baseUrl(ctx)}/fapi/v1/time`,
      );
      return response.data.serverTime;
    } catch (error: any) {
      this.logger.warn(`[BINANCE] Failed to get server time: ${error.message}`);
      return Date.now();
    }
  }
}
