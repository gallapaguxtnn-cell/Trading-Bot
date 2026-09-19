import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  ExchangeClient,
  AccountContext,
  AccountRegion,
  CreateOrderParams,
  OrderResult,
  OrderInfo,
  PositionInfo,
  SymbolRules,
  NeutralSide,
  NeutralMarginMode,
  NeutralPositionMode,
} from './exchange-client.interface';
import { OkxRequestUtil } from '../utils/okx-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { signOkxRequest, okxTimestamp } from './okx-signing.util';
import { toOkxInstId, fromOkxInstId, contractsFromQty, qtyFromContracts } from './okx-symbol.util';
import { buildSimulatedTradingHeaders, assertModeHeaderConsistency, logOkxMode } from './okx-mode.util';

function okxBaseUrl(region: AccountRegion): string {
  if (region === 'EEA') return 'https://eea.okx.com';
  if (region === 'US') return 'https://us.okx.com';
  return 'https://www.okx.com';
}

function toOkxOrderSide(side: NeutralSide): 'buy' | 'sell' {
  return side === 'BUY' ? 'buy' : 'sell';
}

function fromOkxOrderState(state: string): string {
  const map: Record<string, string> = {
    live: 'New',
    filled: 'Filled',
    effective: 'Filled',
    partially_filled: 'PartiallyFilled',
    canceled: 'Cancelled',
    order_failed: 'Cancelled',
  };
  return map[state] ?? state;
}

interface OkxInstrument {
  instId: string;
  lotSz: string;
  minSz: string;
  tickSz: string;
  ctVal: string;
  ctMult: string;
}

const INSTRUMENT_TTL_MS = 60 * 60 * 1000;
const POSMODE_TTL_MS = 30 * 60 * 1000;
const MARGIN_MODE_TTL_MS = 30 * 60 * 1000;

export class OkxApiError extends Error {
  constructor(public code: string, public okxMsg: string, translated: string) {
    super(translated);
    this.name = 'OkxApiError';
  }
}

export function translateOkxError(code: string, msg: string): string {
  const insufficientBalanceCodes = ['51008', '51010', '51011'];
  const precisionCodes = ['51121', '51201', '51202'];
  const reduceOnlyCodes = ['51004', '51023'];
  const wouldTriggerCodes = ['51046', '51047', '51006'];

  if (code === '50110') return 'API Key com IP whitelist: o IP de saida atual nao esta autorizado na OKX. Remova a restricao na chave ou adicione o IP do servidor.';
  if (code === '50111') return `API Key, assinatura ou header invalido na OKX (codigo ${code}): ${msg}`;
  if (code === '50112') return `Timestamp invalido na OKX (codigo ${code}): ${msg} -- verifique o relogio do servidor`;
  if (code === '50113') return `Passphrase invalida na OKX (codigo ${code}): ${msg}`;
  if (insufficientBalanceCodes.includes(code)) return `Saldo insuficiente na OKX (codigo ${code}): ${msg}`;
  if (precisionCodes.includes(code)) return `Erro de precisao de quantidade/preco na OKX (codigo ${code}): ${msg}`;
  if (reduceOnlyCodes.includes(code)) return `Erro de reduceOnly na OKX (codigo ${code}): ${msg} -- a posicao pode nao existir ou a ordem aumentaria a posicao`;
  if (wouldTriggerCodes.includes(code)) return `Ordem dispararia imediatamente na OKX (codigo ${code}): ${msg}`;
  return `Erro da OKX (codigo ${code}): ${msg}`;
}

@Injectable()
export class OkxClientService implements ExchangeClient {
  private readonly logger = new Logger('OKX');
  private readonly rateLimiter = RateLimiterUtil.getInstance();

  private async publicRequest<T = any>(
    region: AccountRegion,
    method: 'GET',
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const query = this.buildQueryString(params);
    const url = `${okxBaseUrl(region)}${path}${query}`;
    const response = await OkxRequestUtil.get(url);
    const payload = response.data;
    if (payload.code !== '0') {
      throw new OkxApiError(payload.code, payload.msg, translateOkxError(payload.code, payload.msg));
    }
    return payload.data as T;
  }

  private buildQueryString(params?: Record<string, string | number | undefined>): string {
    if (!params) return '';
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return '';
    return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  }

  private async privateRequest<T = any>(
    ctx: AccountContext,
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<T> {
    const query = this.buildQueryString(params);
    const requestPath = `${path}${query}`;
    const bodyStr = method === 'POST' && body !== undefined ? JSON.stringify(body) : '';

    const timestamp = okxTimestamp();
    const signature = signOkxRequest(ctx.credentials.apiSecret, timestamp, method, requestPath, bodyStr);

    const modeHeaders = buildSimulatedTradingHeaders(ctx.mode);
    assertModeHeaderConsistency(ctx.mode, modeHeaders);

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': ctx.credentials.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': ctx.credentials.passphrase || '',
      'Content-Type': 'application/json',
      ...modeHeaders,
    };

    const url = `${okxBaseUrl(ctx.region)}${requestPath}`;

    const response = method === 'GET'
      ? await OkxRequestUtil.get(url, { headers })
      : await OkxRequestUtil.post(url, body ?? {}, { headers });

    const payload = response.data;
    if (payload.code !== '0') {
      throw new OkxApiError(payload.code, payload.msg, translateOkxError(payload.code, payload.msg));
    }
    return payload.data as T;
  }

  private async getInstrument(region: AccountRegion, instId: string): Promise<OkxInstrument> {
    const cacheKey = `okx:instrument:${instId}`;
    const cached = this.rateLimiter.getCached<OkxInstrument>(cacheKey);
    if (cached) return cached;

    const data = await this.publicRequest<OkxInstrument[]>(region, 'GET', '/api/v5/public/instruments', {
      instType: 'SWAP',
      instId,
    });
    const instrument = data[0];
    if (!instrument) {
      throw new Error(`[OKX] Instrumento ${instId} nao encontrado em /public/instruments.`);
    }
    this.rateLimiter.setCached(cacheKey, instrument, INSTRUMENT_TTL_MS);
    return instrument;
  }

  async getSymbolRules(ctx: AccountContext, symbol: string): Promise<SymbolRules> {
    const instId = toOkxInstId(symbol);
    const instrument = await this.getInstrument(ctx.region, instId);
    const unitSize = new Decimal(instrument.ctVal).mul(instrument.ctMult);
    return {
      qtyStep: unitSize.mul(instrument.lotSz).toFixed(),
      priceTick: instrument.tickSz,
      minQty: unitSize.mul(instrument.minSz).toFixed(),
      minNotional: '5',
    };
  }

  private async detectPositionModeCached(ctx: AccountContext): Promise<NeutralPositionMode> {
    const cacheKey = `okx:posmode:${ctx.credentials.apiKey.substring(0, 8)}:${ctx.mode}`;
    const cached = this.rateLimiter.getCached<NeutralPositionMode>(cacheKey);
    if (cached) return cached;

    const data = await this.privateRequest<Array<{ posMode: string }>>(ctx, 'GET', '/api/v5/account/config');
    const mode: NeutralPositionMode = data[0]?.posMode === 'long_short_mode' ? 'HEDGE' : 'ONE_WAY';
    this.rateLimiter.setCached(cacheKey, mode, POSMODE_TTL_MS);
    return mode;
  }

  async detectPositionMode(ctx: AccountContext, _symbol: string): Promise<NeutralPositionMode | null> {
    try {
      return await this.detectPositionModeCached(ctx);
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao detectar o modo de posicao: ${error.message}`);
      return null;
    }
  }

  async ensurePositionMode(ctx: AccountContext, _symbol: string, hedgeMode: boolean): Promise<void> {
    const target: NeutralPositionMode = hedgeMode ? 'HEDGE' : 'ONE_WAY';
    const current = await this.detectPositionMode(ctx, _symbol);
    if (current === target) return;

    try {
      await this.privateRequest(ctx, 'POST', '/api/v5/account/set-position-mode', undefined, {
        posMode: hedgeMode ? 'long_short_mode' : 'net_mode',
      });
      const cacheKey = `okx:posmode:${ctx.credentials.apiKey.substring(0, 8)}:${ctx.mode}`;
      this.rateLimiter.setCached(cacheKey, target, POSMODE_TTL_MS);
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao definir o modo de posicao: ${error.message}`);
    }
  }

  getPositionIdx(): Promise<number> {
    return Promise.resolve(0);
  }

  private async getCachedMarginMode(ctx: AccountContext, symbol: string): Promise<'isolated' | 'cross'> {
    const cacheKey = `okx:marginmode:${ctx.credentials.apiKey.substring(0, 8)}:${symbol}:${ctx.mode}`;
    const cached = this.rateLimiter.getCached<'isolated' | 'cross'>(cacheKey);
    return cached ?? 'cross';
  }

  async setMarginMode(ctx: AccountContext, symbol: string, marginMode: NeutralMarginMode, leverage: number): Promise<void> {
    const instId = toOkxInstId(symbol);
    const okxMarginMode = marginMode === 'ISOLATED' ? 'isolated' : 'cross';

    try {
      await this.privateRequest(ctx, 'POST', '/api/v5/account/set-leverage', undefined, {
        instId,
        lever: String(leverage),
        mgnMode: okxMarginMode,
      });
      const cacheKey = `okx:marginmode:${ctx.credentials.apiKey.substring(0, 8)}:${symbol}:${ctx.mode}`;
      this.rateLimiter.setCached(cacheKey, okxMarginMode, MARGIN_MODE_TTL_MS);
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao definir o modo de margem/alavancagem: ${error.message}`);
    }
  }

  async setLeverage(ctx: AccountContext, symbol: string, leverage: number): Promise<void> {
    const instId = toOkxInstId(symbol);
    const mgnMode = await this.getCachedMarginMode(ctx, symbol);
    try {
      await this.privateRequest(ctx, 'POST', '/api/v5/account/set-leverage', undefined, {
        instId,
        lever: String(leverage),
        mgnMode,
      });
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao definir a alavancagem: ${error.message}`);
    }
  }

  async getWalletBalance(ctx: AccountContext): Promise<number> {
    const data = await this.privateRequest<Array<{ details: Array<{ ccy: string; availBal: string; cashBal: string }> }>>(
      ctx, 'GET', '/api/v5/account/balance', { ccy: 'USDT' },
    );
    const usdt = data[0]?.details?.find((d) => d.ccy === 'USDT');
    if (!usdt) {
      throw new Error('[OKX] Saldo USDT nao encontrado na conta.');
    }
    const available = parseFloat(usdt.availBal || '0');
    const cash = parseFloat(usdt.cashBal || '0');
    return available > 0 ? available : cash;
  }

  async getCurrentPrice(ctx: AccountContext, symbol: string): Promise<number> {
    try {
      const instId = toOkxInstId(symbol);
      const data = await this.publicRequest<Array<{ last: string }>>(ctx.region, 'GET', '/api/v5/market/ticker', { instId });
      return parseFloat(data[0]?.last || '0');
    } catch (error: any) {
      this.logger.error(`[OKX] Falha ao obter o preco atual: ${error.message}`);
      return 0;
    }
  }

  async getLastTradePrice(ctx: AccountContext, symbol: string): Promise<number | null> {
    try {
      const instId = toOkxInstId(symbol);
      const data = await this.publicRequest<Array<{ px: string }>>(ctx.region, 'GET', '/api/v5/market/trades', { instId, limit: 1 });
      const px = data[0]?.px;
      return px ? parseFloat(px) : null;
    } catch {
      return null;
    }
  }

  async getServerTime(ctx: AccountContext): Promise<number> {
    try {
      const data = await this.publicRequest<Array<{ ts: string }>>(ctx.region, 'GET', '/api/v5/public/time');
      return parseInt(data[0]?.ts || `${Date.now()}`, 10);
    } catch {
      return Date.now();
    }
  }

  private async mapPositionToInfo(ctx: AccountContext, p: any): Promise<PositionInfo> {
    const instrument = await this.getInstrument(ctx.region, p.instId);
    const size = qtyFromContracts(Math.abs(parseFloat(p.pos)), instrument.ctVal, instrument.ctMult);
    const side: NeutralSide = p.posSide === 'long' ? 'BUY' : p.posSide === 'short' ? 'SELL' : (parseFloat(p.pos) > 0 ? 'BUY' : 'SELL');
    return {
      symbol: fromOkxInstId(p.instId),
      side,
      size,
      avgPrice: p.avgPx || '0',
      unrealizedPnl: p.upl || '0',
      leverage: p.lever || '0',
      markPrice: p.markPx || '0',
      liqPrice: p.liqPx || undefined,
      positionValue: p.notionalUsd || undefined,
    };
  }

  async getPositions(ctx: AccountContext, symbol?: string): Promise<PositionInfo[]> {
    const params: Record<string, string> = { instType: 'SWAP' };
    if (symbol) params.instId = toOkxInstId(symbol);

    const data = await this.privateRequest<any[]>(ctx, 'GET', '/api/v5/account/positions', params);
    const nonZero = data.filter((p) => parseFloat(p.pos || '0') !== 0);
    return Promise.all(nonZero.map((p) => this.mapPositionToInfo(ctx, p)));
  }

  async waitForPosition(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    maxRetries: number = 10,
    delayMs: number = 500,
    _hedgeMode?: boolean,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const positions = await this.getPositions(ctx, symbol);
        const hasPosition = positions.some((p) => p.side === side && parseFloat(p.size) > 0);
        if (hasPosition) {
          this.logger.log(`[OKX] Position confirmed for ${symbol} ${side} after ${attempt} attempt(s)`);
          return true;
        }
      } catch (error: any) {
        this.logger.warn(`[OKX] waitForPosition attempt ${attempt} failed: ${error.message}`);
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  private buildOrderBody(ctx: AccountContext, instId: string, contracts: string, params: CreateOrderParams, isHedge: boolean): Record<string, any> {
    const body: Record<string, any> = {
      instId,
      side: toOkxOrderSide(params.side),
      ordType: params.orderType === 'MARKET' ? 'market' : 'limit',
      sz: contracts,
    };

    if (params.orderType === 'LIMIT' && params.price) {
      body.px = params.price;
    }

    if (isHedge) {
      const positionRef = params.positionSide ?? params.side;
      body.posSide = positionRef === 'BUY' ? 'long' : 'short';
    } else {
      body.posSide = 'net';
      if (params.reduceOnly) {
        body.reduceOnly = true;
      }
    }

    return body;
  }

  async createOrder(ctx: AccountContext, params: CreateOrderParams): Promise<OrderResult> {
    const instId = toOkxInstId(params.symbol);
    const instrument = await this.getInstrument(ctx.region, instId);
    const contracts = contractsFromQty(params.qty, instrument.ctVal, instrument.ctMult, instrument.lotSz);

    if (new Decimal(contracts).lessThanOrEqualTo(0)) {
      throw new Error(
        `[OKX] Quantidade ${params.qty} convertida para 0 contratos (ctVal=${instrument.ctVal}, ctMult=${instrument.ctMult}, lotSz=${instrument.lotSz}). Abortando ordem.`,
      );
    }

    const isHedge = params.hedgeMode ?? false;
    const mgnMode = await this.getCachedMarginMode(ctx, params.symbol);
    const body = { ...this.buildOrderBody(ctx, instId, contracts, params, isHedge), tdMode: mgnMode };

    logOkxMode(ctx.mode, 'createOrder');
    const data = await this.privateRequest<Array<{ ordId: string; sCode: string; sMsg: string }>>(
      ctx, 'POST', '/api/v5/trade/order', undefined, body,
    );
    const result = data[0];
    if (!result || result.sCode !== '0') {
      throw new OkxApiError(result?.sCode ?? 'unknown', result?.sMsg ?? 'sem resposta', translateOkxError(result?.sCode ?? 'unknown', result?.sMsg ?? 'sem resposta'));
    }
    return { orderId: result.ordId };
  }

  async createStopLossOrder(
    ctx: AccountContext,
    symbol: string,
    side: NeutralSide,
    qty: string,
    triggerPrice: string,
    hedgeMode?: boolean,
  ): Promise<OrderResult> {
    const instId = toOkxInstId(symbol);
    const instrument = await this.getInstrument(ctx.region, instId);
    const contracts = contractsFromQty(qty, instrument.ctVal, instrument.ctMult, instrument.lotSz);

    if (new Decimal(contracts).lessThanOrEqualTo(0)) {
      throw new Error(
        `[OKX] Quantidade ${qty} convertida para 0 contratos (ctVal=${instrument.ctVal}, ctMult=${instrument.ctMult}, lotSz=${instrument.lotSz}). Abortando SL.`,
      );
    }

    const closeSide = toOkxOrderSide(side === 'BUY' ? 'SELL' : 'BUY');
    const mgnMode = await this.getCachedMarginMode(ctx, symbol);

    const body: Record<string, any> = {
      instId,
      tdMode: mgnMode,
      side: closeSide,
      ordType: 'conditional',
      sz: contracts,
      slTriggerPx: triggerPrice,
      slOrdPx: '-1',
    };

    if (hedgeMode) {
      body.posSide = side === 'BUY' ? 'long' : 'short';
    } else {
      body.posSide = 'net';
      body.reduceOnly = true;
    }

    logOkxMode(ctx.mode, 'createStopLossOrder');
    const data = await this.privateRequest<Array<{ algoId: string; sCode: string; sMsg: string }>>(
      ctx, 'POST', '/api/v5/trade/order-algo', undefined, body,
    );
    const result = data[0];
    if (!result || result.sCode !== '0') {
      throw new OkxApiError(result?.sCode ?? 'unknown', result?.sMsg ?? 'sem resposta', translateOkxError(result?.sCode ?? 'unknown', result?.sMsg ?? 'sem resposta'));
    }
    return { orderId: result.algoId };
  }

  setTradingStop(): Promise<boolean> {
    throw new Error('setTradingStop nao e suportado pela OKX -- use createStopLossOrder (ordem algo)');
  }

  clearTradingStop(): Promise<boolean> {
    throw new Error('clearTradingStop nao e suportado pela OKX -- cancele a ordem algo diretamente');
  }

  private async cancelAlgoOrder(ctx: AccountContext, instId: string, algoId: string): Promise<{ sCode: string; sMsg: string }> {
    const data = await this.privateRequest<Array<{ sCode: string; sMsg: string }>>(
      ctx, 'POST', '/api/v5/trade/cancel-algos', undefined, [{ instId, algoId }],
    );
    return data[0] ?? { sCode: 'unknown', sMsg: 'sem resposta' };
  }

  private async cancelRegularOrder(ctx: AccountContext, instId: string, ordId: string): Promise<{ sCode: string; sMsg: string }> {
    const data = await this.privateRequest<Array<{ sCode: string; sMsg: string }>>(
      ctx, 'POST', '/api/v5/trade/cancel-order', undefined, { instId, ordId },
    );
    return data[0] ?? { sCode: 'unknown', sMsg: 'sem resposta' };
  }

  async cancelOrder(ctx: AccountContext, symbol: string, orderId: string): Promise<boolean> {
    const instId = toOkxInstId(symbol);
    try {
      const algoResult = await this.cancelAlgoOrder(ctx, instId, orderId);
      if (algoResult.sCode === '0') return true;
    } catch {
      // segue para a tentativa de ordem regular
    }

    try {
      const regularResult = await this.cancelRegularOrder(ctx, instId, orderId);
      return regularResult.sCode === '0';
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao cancelar ordem ${orderId}: ${error.message}`);
      return false;
    }
  }

  async cancelAllOrders(ctx: AccountContext, symbol: string, _positionSide?: NeutralSide): Promise<boolean> {
    const instId = toOkxInstId(symbol);
    let ok = true;

    try {
      const openOrders = await this.getOpenOrders(ctx, symbol);
      for (const order of openOrders) {
        try {
          await this.cancelRegularOrder(ctx, instId, order.orderId);
        } catch (error: any) {
          ok = false;
          this.logger.warn(`[OKX] Falha ao cancelar ordem ${order.orderId}: ${error.message}`);
        }
      }
    } catch (error: any) {
      ok = false;
      this.logger.warn(`[OKX] Falha ao buscar/cancelar ordens abertas: ${error.message}`);
    }

    try {
      const algoOrders = await this.privateRequest<any[]>(ctx, 'GET', '/api/v5/trade/orders-algo-pending', {
        instId,
        ordType: 'conditional',
      });
      for (const algoOrder of algoOrders) {
        try {
          await this.cancelAlgoOrder(ctx, instId, algoOrder.algoId);
        } catch (error: any) {
          this.logger.warn(`[OKX] Falha ao cancelar ordem algo ${algoOrder.algoId}: ${error.message}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`[OKX] Falha ao buscar/cancelar ordens algo: ${error.message}`);
    }

    return ok;
  }

  private mapRegularOrder(o: any): OrderInfo {
    return {
      orderId: String(o.ordId),
      symbol: fromOkxInstId(o.instId),
      side: o.side,
      orderType: o.ordType,
      price: o.px,
      qty: o.sz,
      orderStatus: fromOkxOrderState(o.state),
      avgPrice: o.avgPx || '0',
      cumExecQty: o.accFillSz || '0',
      cumExecFee: o.fee,
      updatedTime: o.uTime,
    };
  }

  private mapAlgoOrder(o: any): OrderInfo {
    return {
      orderId: String(o.algoId),
      symbol: fromOkxInstId(o.instId),
      side: o.side,
      orderType: o.ordType,
      price: o.slTriggerPx ?? o.tpTriggerPx,
      qty: o.sz,
      orderStatus: fromOkxOrderState(o.state),
      avgPrice: o.actualPx || '0',
      cumExecQty: o.actualSz || '0',
      cumExecFee: undefined,
      updatedTime: o.uTime,
    };
  }

  async getOrderInfo(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null> {
    const instId = toOkxInstId(symbol);

    try {
      const data = await this.privateRequest<any[]>(ctx, 'GET', '/api/v5/trade/order-algo', { instId, algoId: orderId });
      if (data[0]) return this.mapAlgoOrder(data[0]);
    } catch {
      // nao e uma ordem algo, tenta como regular
    }

    try {
      const data = await this.privateRequest<any[]>(ctx, 'GET', '/api/v5/trade/order', { instId, ordId: orderId });
      if (data[0]) return this.mapRegularOrder(data[0]);
    } catch {
      // segue para retorno null
    }

    return null;
  }

  async getOrderHistory(ctx: AccountContext, symbol: string, orderId: string): Promise<OrderInfo | null> {
    return this.getOrderInfo(ctx, symbol, orderId);
  }

  async getOpenOrders(ctx: AccountContext, symbol?: string): Promise<OrderInfo[]> {
    const params: Record<string, string> = { instType: 'SWAP' };
    if (symbol) params.instId = toOkxInstId(symbol);

    const data = await this.privateRequest<any[]>(ctx, 'GET', '/api/v5/trade/orders-pending', params);
    return data.map((o) => this.mapRegularOrder(o));
  }
}
