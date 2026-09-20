import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, CloseReason } from '../strategies/trade.entity';
import { TradesService } from '../trades/trades.service';
import { ExecutionType } from '../trades/trade-execution.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import type { AccountContext, ExchangeClient } from '../exchange/exchange-client.interface';
import { toAccountContext } from '../common/account-context.util';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { OrderUpdateEvent } from '../binance-ws/dto/binance-ws-events.dto';
import { isPendingLimitEntry } from '../utils/trade-guards.util';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { normalizeQuantity, roundPriceToTick } from '../common/exchange-precision.util';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { POSITION_CHECK_RETRY_LIMIT, PositionCheckResult, shouldEscalateToReconciliation } from '../common/position-reconciliation.util';
import { OrderFill, mapBybitFill, mapBinanceFill, mapCcxtFill, tpPnl, sumCommission } from '../take-profit/fill.util';
import {
  SL_MISSING_RETRY_LIMIT,
  parseSlMissingRetryCount,
  incrementSlMissingRetry,
  clearSlMissingRetry,
  shouldFallbackToMarketSl,
  computeSlTargetVsExecutedDiffPct,
  formatSlFallbackCloseDetail,
} from './sl-missing-fallback.util';
import * as crypto from 'crypto';

@Injectable()
export class StopLossService implements OnModuleInit {
  private readonly logger = new Logger(StopLossService.name);
  private readonly BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
  private readonly BINANCE_MAINNET_URL = 'https://fapi.binance.com';
  private readonly processingTrades = new Set<string>();
  private readonly fallbackEnabled: boolean;

  constructor(
    @InjectRepository(Trade)
    private tradesRepository: Repository<Trade>,
    @Inject(forwardRef(() => TradesService))
    private tradesService: TradesService,
    private strategiesService: StrategiesService,
    private exchangeService: ExchangeService,
    private exchangeFactory: ExchangeClientFactory,
    private binanceWs: BinanceWebSocketService,
    private symbolRulesService: SymbolRulesService,
    private credentialsResolver: CredentialsResolverService,
    private eventEmitter: EventEmitter2,
  ) {
    this.fallbackEnabled = process.env.BINANCE_WS_FALLBACK_ENABLED !== 'false';
  }

  onModuleInit() {
    if (this.binanceWs.isEnabled()) {
      this.logger.log('[WS] Stop Loss WebSocket listeners registered');
    }
  }

  private formatQuantityWithUsdt(quantity: number, price: number): string {
    const usdt = quantity * price;
    return `${quantity.toFixed(4)} (~${usdt.toFixed(2)} USDT)`;
  }

  @OnEvent('binance.order.update')
  async handleOrderUpdate(event: OrderUpdateEvent) {
    if (event.orderType !== 'STOP_MARKET' && event.orderType !== 'STOP') {
      return;
    }

    if (event.status !== 'FILLED') {
      return;
    }

    const trade = await this.tradesRepository.findOne({
      where: { stopLossOrderId: event.orderId }
    });

    if (!trade) return;

    this.logger.log(`[WS] Stop Loss filled: ${event.symbol} - ${event.orderId}`);

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) return;
    const credentials = await this.credentialsResolver.resolveCredentials(strategy);
    const resolvedStrategy = { ...strategy, ...credentials };

    const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
    const apiKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();

    await this.markTradeAsClosed(trade, 'STOP_LOSS', exchange, apiKey, apiSecret, resolvedStrategy.isTestnet, event.orderId, resolvedStrategy.siteId);
  }

  @Cron('*/10 * * * * *')
  async monitorStopLoss() {
    if (!this.fallbackEnabled && this.binanceWs.isEnabled()) {
      return;
    }

    const openTrades = await this.tradesRepository.find({ where: { status: 'OPEN' } });

    if (openTrades.length === 0) return;

    for (const trade of openTrades) {
      if (this.processingTrades.has(trade.id)) {
        continue;
      }

      try {
        this.processingTrades.add(trade.id);
        await this.checkStopLoss(trade);
      } catch (error) {
        this.logger.error(`Error checking stop-loss for trade ${trade.id}: ${error.message}`);
      } finally {
        this.processingTrades.delete(trade.id);
      }
    }
  }

  private async checkStopLoss(trade: Trade) {
    if (isPendingLimitEntry(trade)) return;
    if (trade.needsReconciliation) return;

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) return;
    const credentials = await this.credentialsResolver.resolveCredentials(strategy);
    const resolvedStrategy = { ...strategy, ...credentials };

    const exchange = resolvedStrategy.exchange || Exchange.BINANCE;
    const apiKey = (await EncryptionUtil.decrypt(resolvedStrategy.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(resolvedStrategy.apiSecret)).trim();
    const client = this.exchangeFactory.get(exchange);
    const ctx = toAccountContext(credentials, apiKey, apiSecret);

    if (trade.stopLossOrderId && trade.stopLossOrderId.trim() !== '') {
      if (trade.stopLossOrderId.startsWith('BYBIT_TRADING_STOP')) {
        const positions = await client.getPositions(ctx, trade.symbol);
        const position = positions.find(p =>
          p.symbol === trade.symbol &&
          ((trade.side === 'BUY' && p.side === 'BUY') || (trade.side === 'SELL' && p.side === 'SELL'))
        );

        if (!position || parseFloat(position.size) === 0) {
          this.logger.log(`[STOP LOSS EXECUTED] ${trade.symbol} - Position closed on Bybit`);
          await this.markTradeAsClosed(trade, 'STOP_LOSS', exchange, apiKey, apiSecret, resolvedStrategy.isTestnet, undefined, resolvedStrategy.siteId);
          return;
        }
        return;
      }

      const orderStatus = await this.checkOrderStatus(client, ctx, exchange, trade.stopLossOrderId, trade.symbol);

      if (orderStatus === 'FILLED' || orderStatus === 'Filled') {
        this.logger.log(`[STOP LOSS EXECUTED] ${trade.symbol} - Order was filled`);
        await this.markTradeAsClosed(trade, 'STOP_LOSS', exchange, apiKey, apiSecret, resolvedStrategy.isTestnet, trade.stopLossOrderId, resolvedStrategy.siteId);
        return;
      } else if (orderStatus === 'CANCELED' || orderStatus === 'EXPIRED' || orderStatus === 'Cancelled' || orderStatus === 'Deactivated') {
        this.logger.warn(`[STOP LOSS] Order ${trade.stopLossOrderId} was ${orderStatus}, attempting to recreate SL`);

        const recreated = await this.recreateStopLoss(trade, resolvedStrategy, exchange, apiKey, apiSecret);
        if (!recreated) {
          this.logger.warn(`[STOP LOSS] Could not recreate SL for ${trade.symbol}, falling back to manual monitoring`);
          trade.stopLossOrderId = null;
          await this.tradesRepository.save(trade);
        }
        return;
      } else if (orderStatus === 'NEW' || orderStatus === 'New') {
        return;
      }
    }

    if (!resolvedStrategy.stopLossPercentage) return;

    const missingOrder = !trade.stopLossOrderId || trade.stopLossOrderId.trim() === '';

    if (missingOrder && !trade.isFromAveraging) {
      if (!shouldFallbackToMarketSl(trade.slWarnings)) {
        const recreated = await this.recreateStopLoss(trade, resolvedStrategy, exchange, apiKey, apiSecret);
        if (recreated) {
          const clearedWarnings = clearSlMissingRetry(trade.slWarnings);
          if (clearedWarnings !== trade.slWarnings) {
            await this.tradesRepository.update(trade.id, { slWarnings: clearedWarnings });
          }
          return;
        }

        const nextSlWarnings = incrementSlMissingRetry(trade.slWarnings);
        await this.tradesRepository.update(trade.id, { slWarnings: nextSlWarnings });
        this.eventEmitter.emit('limit.protection.resume', { tradeId: trade.id });
        this.logger.warn(
          `[SL] ${trade.symbol} sem ordem de stop na corretora — solicitando recriacao ` +
          `(tentativa ${parseSlMissingRetryCount(nextSlWarnings)}/${SL_MISSING_RETRY_LIMIT})`
        );
        return;
      }
    }

    const currentPrice = await this.getCurrentPrice(trade, resolvedStrategy);
    if (!currentPrice) return;

    const stopLossPrice = this.calculateStopLoss(trade, resolvedStrategy);

    const shouldTrigger =
      (trade.side === 'BUY' && currentPrice <= stopLossPrice) ||
      (trade.side === 'SELL' && currentPrice >= stopLossPrice);

    if (shouldTrigger) {
      const entryPrice = parseFloat(trade.entryPrice as any);
      const lossPercent = trade.side === 'BUY'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      const rules = await this.symbolRulesService.getSymbolRules(trade.symbol, resolvedStrategy.isTestnet, exchange);
      const entryPriceLabel = roundPriceToTick(entryPrice, rules.priceTick);
      const currentPriceLabel = roundPriceToTick(currentPrice, rules.priceTick);
      const stopLossPriceLabel = roundPriceToTick(stopLossPrice, rules.priceTick);

      const positionCheck = await this.checkLivePosition(trade, client, ctx);

      if (positionCheck === 'NOT_FOUND') {
        this.logger.error(
          `[SL] ${trade.symbol}: preco cruzou o alvo (Entry ${entryPriceLabel} → ${currentPriceLabel}, ${lossPercent.toFixed(2)}%) mas nao ha posicao aberta na corretora -- ` +
          `trade ${trade.id} fechado localmente para reconciliacao (evita "current position is zero, cannot fix reduce-only order qty")`
        );
        await this.closeAsPositionNotFound(trade, currentPrice);
        return;
      }

      if (positionCheck === 'CHECK_FAILED') {
        await this.registerPositionCheckFailure(trade, 'Falha ao consultar a posicao na corretora antes de disparar o SL');
        return;
      }

      const isFallback = missingOrder && !trade.isFromAveraging;
      const reason: CloseReason = isFallback ? 'STOP_LOSS_FALLBACK_MARKET' : 'STOP_LOSS';

      if (isFallback) {
        this.logger.error(
          `[SL FALLBACK MARKET] ${trade.symbol} apos ${SL_MISSING_RETRY_LIMIT} tentativas sem ordem de stop na corretora — ` +
          `alvo=${stopLossPrice.toFixed(8)} executado~=${currentPrice.toFixed(8)} diff=${computeSlTargetVsExecutedDiffPct(stopLossPrice, currentPrice).toFixed(4)}%`
        );
        trade.slWarnings = clearSlMissingRetry(trade.slWarnings) as any;
        trade.closeDetail = formatSlFallbackCloseDetail(stopLossPrice) as any;
      } else {
        this.logger.warn(`[STOP-LOSS TRIGGERED] ${trade.symbol}`);
      }
      this.logger.warn(`├─ Entry: ${entryPriceLabel} → Exit: ${currentPriceLabel} (${lossPercent.toFixed(2)}%)`);
      this.logger.warn(`└─ SL Price: ${stopLossPriceLabel}`);
      await this.closePosition(trade, resolvedStrategy, currentPrice, reason, apiKey, apiSecret);
    }
  }

  private async checkLivePosition(trade: Trade, client: ExchangeClient, ctx: AccountContext): Promise<PositionCheckResult> {
    try {
      const positions = await client.getPositions(ctx, trade.symbol);
      const live = positions.find(p => p.symbol === trade.symbol && p.side === trade.side && parseFloat(p.size) > 0);
      return live ? 'LIVE' : 'NOT_FOUND';
    } catch {
      return 'CHECK_FAILED';
    }
  }

  private async registerPositionCheckFailure(trade: Trade, reason: string): Promise<void> {
    const nextFailures = (trade.positionCheckFailures || 0) + 1;

    if (shouldEscalateToReconciliation(nextFailures)) {
      await this.tradesRepository.update(trade.id, { positionCheckFailures: nextFailures, needsReconciliation: true });
      this.logger.error(
        `[SL] Trade ${trade.id} (${trade.symbol}) precisa de reconciliacao manual apos ${nextFailures} falha(s) consecutiva(s): ${reason}. ` +
        `Monitoramento automatico interrompido para este trade.`
      );
      return;
    }

    await this.tradesRepository.update(trade.id, { positionCheckFailures: nextFailures });
    this.logger.warn(`[SL] ${reason} (tentativa ${nextFailures}/${POSITION_CHECK_RETRY_LIMIT})`);
  }

  private async escalateImmediately(trade: Trade, reason: string): Promise<void> {
    await this.tradesRepository.update(trade.id, { needsReconciliation: true });
    this.logger.error(
      `[SL] Trade ${trade.id} (${trade.symbol}) precisa de reconciliacao manual: ${reason}. ` +
      `Monitoramento automatico interrompido para este trade.`
    );
  }

  private async closeAsPositionNotFound(trade: Trade, lastKnownPrice: number): Promise<void> {
    const pnl = this.calculatePnL(trade, lastKnownPrice);
    const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

    trade.status = 'CLOSED';
    trade.exitPrice = lastKnownPrice as any;
    trade.pnl = totalPnl as any;
    trade.closeReason = 'POSITION_NOT_FOUND';
    trade.closedAt = new Date();
    trade.binancePositionAmt = 0 as any;
    trade.excludeFromStats = true;
    trade.error = 'Posicao nao encontrada na corretora quando o SL disparou -- fechado localmente para reconciliacao';

    await this.tradesRepository.save(trade);

    this.logger.warn(`[SL] Trade ${trade.id} (${trade.symbol}) fechado localmente por reconciliacao (posicao fantasma)`);
  }

  private async recreateStopLoss(
    trade: Trade,
    strategy: any,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string
  ): Promise<boolean> {
    try {
      if (!strategy.stopLossPercentage || strategy.stopLossPercentage <= 0) return false;

      const client = this.exchangeFactory.get(exchange);
      const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: strategy.isTestnet ? 'DEMO' : 'REAL', region: strategy.siteId ?? null };

      const positionSide = strategy.hedgeMode
        ? (trade.side === 'BUY' ? 'LONG' : 'SHORT')
        : 'BOTH';

      const positions = await client.getPositions(ctx, trade.symbol);
      const position = positions.find(p => {
        if (p.symbol !== trade.symbol) return false;
        if (strategy.hedgeMode) {
          return p.side === trade.side;
        }
        return true;
      });

      if (!position || parseFloat(position.size) === 0) {
        this.logger.warn(`[SL RECREATE] No open position found for ${trade.symbol}, skipping`);
        return false;
      }

      const remainingQty = parseFloat(trade.quantity as any);
      if (!remainingQty || remainingQty <= 0) return false;

      // CRITICAL: Use currentStopLoss if Break Even/Break Again has moved the SL
      let stopPrice: number;
      if (trade.currentStopLoss) {
        stopPrice = parseFloat(trade.currentStopLoss as any);
        this.logger.log(`[SL RECREATE] Using currentStopLoss: ${stopPrice} (Break Even/Break Again price)`);
      } else {
        const entryPrice = parseFloat(trade.entryPrice as any);
        const slPercent = strategy.stopLossPercentage / 100;
        stopPrice = trade.side === 'BUY'
          ? entryPrice * (1 - slPercent)
          : entryPrice * (1 + slPercent);
        this.logger.log(`[SL RECREATE] Using original SL: ${stopPrice} (${strategy.stopLossPercentage}%)`);
      }

      const rules = await this.symbolRulesService.getSymbolRules(trade.symbol, strategy.isTestnet, exchange);
      const qty = normalizeQuantity(remainingQty, rules.qtyStep, rules.minQty);

      if (qty === '0') {
        this.logger.error(
          `[SL RECREATE] Normalized quantity for ${trade.symbol} rounded to 0 (raw=${remainingQty}, step=${rules.qtyStep}, minQty=${rules.minQty}). Aborting SL recreation.`
        );
        return false;
      }

      const triggerPrice = roundPriceToTick(stopPrice, rules.priceTick);

      const result = await client.createStopLossOrder(ctx, trade.symbol, trade.side as any, qty, String(triggerPrice), strategy.hedgeMode);

      trade.stopLossOrderId = result.orderId;
      await this.tradesRepository.save(trade);

      this.logger.log(`[SL RECREATE] Successfully recreated SL for ${trade.symbol}: orderId=${result.orderId}, stopPrice=${triggerPrice}`);
      return true;
    } catch (error: any) {
      this.logger.error(`[SL RECREATE] Failed to recreate SL: ${error.message}`);
      return false;
    }
  }

  private async checkOrderStatus(
    client: ExchangeClient,
    ctx: AccountContext,
    exchange: Exchange,
    orderId: string,
    symbol: string,
  ): Promise<string | null> {
    try {
      let orderInfo = await client.getOrderInfo(ctx, symbol, orderId);
      if (!orderInfo) {
        orderInfo = await client.getOrderHistory(ctx, symbol, orderId);
      }
      if (!orderInfo) return null;

      if (exchange === Exchange.BINANCE) {
        // Algo Order status mapping: WORKING -> NEW (active), CANCELLED -> CANCELED, FILLED passthrough
        if (orderInfo.orderStatus === 'WORKING') return 'NEW';
        if (orderInfo.orderStatus === 'CANCELLED') return 'CANCELED';
      }

      return orderInfo.orderStatus || null;
    } catch (error: any) {
      this.logger.error(`Failed to check order status for ${orderId}: ${error.message}`);
      return null;
    }
  }

  private async cancelTradeSpecificTpOrders(
    trade: Trade,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    siteId?: string | null
  ): Promise<void> {
    if (!trade.takeProfitOrderId) return;

    const client = this.exchangeFactory.get(exchange);
    const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: isTestnet ? 'DEMO' : 'REAL', region: (siteId as any) ?? null };

    if (trade.takeProfitOrderId.startsWith('BYBIT_TRADING_STOP')) {
      const bybitSide = trade.side === 'BUY' ? 'BUY' : 'SELL';
      const strategy = await this.strategiesService.findOne(trade.strategyId);
      if (strategy) {
        try {
          await client.clearTradingStop(ctx, trade.symbol, bybitSide as any, strategy.hedgeMode);
          this.logger.log(`[SL] Cleared Bybit trading stop for ${trade.symbol} after SL execution`);
        } catch (e: any) {
          this.logger.warn(`[SL] Failed to clear Bybit trading stop: ${e.message}`);
        }
      }
      return;
    }

    const entries = trade.takeProfitOrderId.split('|');
    for (const entry of entries) {
      const orderId = entry.includes(':') ? entry.split(':')[1] : entry;
      if (!orderId || orderId === 'null' || orderId === 'undefined') continue;

      try {
        await client.cancelOrder(ctx, trade.symbol, orderId);
        this.logger.log(`[SL] Cancelled TP order ${orderId} after SL execution`);
      } catch (e: any) {
        this.logger.warn(`[SL] Failed to cancel TP order ${orderId}: ${e.message}`);
      }
    }
  }

  private async markTradeAsClosed(
    trade: Trade,
    reason: CloseReason,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    orderId?: string | null,
    siteId?: string | null
  ): Promise<void> {
    const entryPrice = parseFloat(trade.entryPrice as any);
    let fill: OrderFill | null = null;

    if (orderId) {
      fill = await this.fetchOrderFill(orderId, trade.symbol, exchange, apiKey, apiSecret, isTestnet, siteId);
    }

    let exitPrice: number;
    let closedQty: number;
    let fee: number | null = null;
    let pnl: number;

    if (fill?.avgPrice != null) {
      exitPrice = fill.avgPrice;
      closedQty = fill.executedQty ?? parseFloat(trade.quantity as any);
      fee = fill.fee;
      pnl = tpPnl(trade.side, entryPrice, exitPrice, closedQty, fee).net;
    } else {
      this.logger.error(
        `[SL PNL] ${trade.symbol}: nao foi possivel ler o resultado real da ordem de stop na corretora (orderId=${orderId ?? 'indisponivel'}) -- usando ultimo preco negociado e calculo local sem taxas como fallback.`
      );
      const lastPrice = await this.getLastTradePrice(trade.symbol, exchange, apiKey, apiSecret, isTestnet, siteId);
      exitPrice = lastPrice || await this.getCurrentPrice(trade, { exchange, isTestnet } as any);
      closedQty = parseFloat(trade.quantity as any);
      pnl = this.calculatePnL(trade, exitPrice);
    }

    await this.cancelTradeSpecificTpOrders(trade, exchange, apiKey, apiSecret, isTestnet, siteId);

    const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

    try {
      await this.tradesService.createExecution({
        tradeId: trade.id,
        type: ExecutionType.STOP_LOSS,
        price: exitPrice,
        quantity: closedQty,
        pnl,
        fee,
        percentOfPosition: 100,
        exchangeOrderId: orderId || trade.stopLossOrderId || undefined,
      });
    } catch (e: any) {
      this.logger.warn(`[SL] Falha ao gravar execucao: ${e.message}`);
    }

    trade.status = 'CLOSED';
    trade.exitPrice = exitPrice as any;
    trade.pnl = totalPnl;
    trade.closeReason = reason;
    trade.closedAt = new Date();
    trade.binancePositionAmt = 0 as any;

    await this.tradesRepository.save(trade);

    this.logger.log(`[CLOSED] ${trade.symbol} via ${reason} | P&L: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT`);
  }

  private async fetchOrderFill(
    orderId: string,
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    siteId?: string | null
  ): Promise<OrderFill | null> {
    try {
      const client = this.exchangeFactory.get(exchange);
      const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: isTestnet ? 'DEMO' : 'REAL', region: (siteId as any) ?? null };

      let orderInfo = await client.getOrderInfo(ctx, symbol, orderId);
      if (!orderInfo) {
        orderInfo = await client.getOrderHistory(ctx, symbol, orderId);
      }

      const fill = mapBybitFill(orderInfo as unknown as Record<string, unknown> | null);

      if (exchange === Exchange.BINANCE && fill && fill.fee == null && fill.status && /FILLED/i.test(fill.status)) {
        const fee = await this.fetchBinanceCommission(orderId, symbol, apiKey, apiSecret, isTestnet);
        if (fee != null) fill.fee = fee;
      }

      return fill;
    } catch (error: any) {
      this.logger.warn(`[SL] Failed to fetch order fill (${orderId}): ${error.message}`);
      return null;
    }
  }

  private async fetchBinanceCommission(
    orderId: string,
    symbol: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<number | null> {
    try {
      const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

      const response = await BinanceRequestUtil.get(
        `${baseUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      return sumCommission(response.data as Array<Record<string, unknown>>);
    } catch (error: any) {
      this.logger.warn(`[SL] Failed to fetch Binance commission (${orderId}): ${error.message}`);
      return null;
    }
  }

  private async getLastTradePrice(
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    siteId?: string | null
  ): Promise<number | null> {
    const client = this.exchangeFactory.get(exchange);
    const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: isTestnet ? 'DEMO' : 'REAL', region: (siteId as any) ?? null };
    return client.getLastTradePrice(ctx, symbol);
  }

  private calculateStopLoss(trade: Trade, strategy: any): number {
    // If Break Even/Break Again has moved the SL, use that instead of recalculating
    if (trade.currentStopLoss) {
      return parseFloat(trade.currentStopLoss as any);
    }

    const slPercent = strategy.stopLossPercentage / 100;
    const entryPrice = parseFloat(trade.entryPrice as any);

    if (trade.side === 'BUY') {
      return entryPrice * (1 - slPercent);
    } else {
      return entryPrice * (1 + slPercent);
    }
  }

  private async getCurrentPrice(trade: Trade, strategy: any): Promise<number> {
    try {
      const exchange = strategy.exchange || Exchange.BINANCE;

      if (exchange === Exchange.BYBIT) {
        const client = this.exchangeFactory.get(exchange);
        const ctx: AccountContext = { credentials: { apiKey: '', apiSecret: '' }, mode: strategy.isTestnet ? 'DEMO' : 'REAL', region: null };
        return await client.getCurrentPrice(ctx, trade.symbol);
      }

      if (exchange === Exchange.BINANCE && this.binanceWs.isEnabled()) {
        const cachedPrice = this.binanceWs.getCachedPrice(trade.symbol);
        if (cachedPrice) {
          return cachedPrice;
        }
      }

      if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const client = this.exchangeFactory.get(exchange);
        const ctx: AccountContext = { credentials: { apiKey: '', apiSecret: '' }, mode: 'DEMO', region: null };
        return await client.getCurrentPrice(ctx, trade.symbol);
      } else {
        const apiKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
        const apiSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

        const exchangeInstance = await this.exchangeService.getExchange(
          exchange,
          apiKey,
          apiSecret,
          strategy.isTestnet
        );

        const ticker = await exchangeInstance.fetchTicker(trade.symbol);
        return ticker.last;
      }
    } catch (error) {
      this.logger.error(`Failed to get current price for ${trade.symbol}: ${error.message}`);
      return 0;
    }
  }

  private async closePosition(
    trade: Trade,
    strategy: any,
    exitPrice: number,
    reason: CloseReason,
    apiKey: string,
    apiSecret: string
  ) {
    try {
      const exchange = strategy.exchange || Exchange.BINANCE;
      const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const quantity = parseFloat(trade.quantity as any);
      let fill: OrderFill | null = null;

      if (exchange === Exchange.BYBIT) {
        const rules = await this.symbolRulesService.getSymbolRules(trade.symbol, strategy.isTestnet, Exchange.BYBIT);
        const closeQty = normalizeQuantity(quantity, rules.qtyStep, rules.minQty);

        if (closeQty === '0') {
          this.logger.error(
            `[BYBIT] Normalized quantity for ${trade.symbol} rounded to 0 (raw=${quantity}, step=${rules.qtyStep}, minQty=${rules.minQty}). Aborting close.`
          );
          return;
        }

        const client = this.exchangeFactory.get(exchange);
        const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: strategy.isTestnet ? 'DEMO' : 'REAL', region: strategy.siteId ?? null };

        const order = await client.createOrder(ctx, {
          symbol: trade.symbol,
          side: closeSide as any,
          orderType: 'MARKET',
          qty: closeQty,
          reduceOnly: true,
          hedgeMode: strategy.hedgeMode,
          positionSide: trade.side as any,
        });
        this.logger.warn(`[BYBIT] Closed ${trade.symbol} via ${reason}`);

        if (order?.orderId) {
          await new Promise(resolve => setTimeout(resolve, 500));
          fill = await this.fetchOrderFill(order.orderId, trade.symbol, Exchange.BYBIT, apiKey, apiSecret, strategy.isTestnet, strategy.siteId);
        }
      } else if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const rules = await this.symbolRulesService.getSymbolRules(trade.symbol, strategy.isTestnet, Exchange.BINANCE);
        const closeQty = normalizeQuantity(quantity, rules.qtyStep, rules.minQty);

        if (closeQty === '0') {
          this.logger.error(
            `[BINANCE] Normalized quantity for ${trade.symbol} rounded to 0 (raw=${quantity}, step=${rules.qtyStep}, minQty=${rules.minQty}). Aborting close.`
          );
          return;
        }

        const client = this.exchangeFactory.get(exchange);
        const ctx: AccountContext = { credentials: { apiKey, apiSecret }, mode: strategy.isTestnet ? 'DEMO' : 'REAL', region: null };

        const order = await client.createOrder(ctx, {
          symbol: trade.symbol,
          side: closeSide as any,
          orderType: 'MARKET',
          qty: closeQty,
          hedgeMode: strategy.hedgeMode,
          positionSide: trade.side as any,
        });

        fill = mapBinanceFill(order as unknown as Record<string, unknown>);
        if (fill && fill.fee == null && order.orderId) {
          const fee = await this.fetchBinanceCommission(order.orderId, trade.symbol, apiKey, apiSecret, strategy.isTestnet);
          if (fee != null) fill.fee = fee;
        }

        this.logger.warn(`[BINANCE] Closed ${trade.symbol} via ${reason}`);
      } else {
        const exchangeInstance = await this.exchangeService.getExchange(
          exchange,
          apiKey,
          apiSecret,
          strategy.isTestnet
        );

        const ccxtParams: any = {};
        if (strategy.hedgeMode) {
          const positionSide = trade.side === 'BUY' ? 'LONG' : 'SHORT';
          ccxtParams.positionSide = positionSide;
        }

        const closeOrder = await exchangeInstance.createMarketOrder(trade.symbol, closeSide.toLowerCase(), quantity, ccxtParams);
        fill = mapCcxtFill(closeOrder as unknown as Record<string, unknown>);
        this.logger.warn(`[CLOSED] ${trade.symbol} via ${reason}`);
      }

      await this.cancelTradeSpecificTpOrders(trade, exchange, apiKey, apiSecret, strategy.isTestnet, strategy.siteId);

      const entryPrice = parseFloat(trade.entryPrice as any);
      const fillPrice = fill?.avgPrice ?? exitPrice;
      const fillQty = fill?.executedQty ?? quantity;
      let pnl: number;
      let fee: number | null = null;

      if (fill?.avgPrice != null) {
        fee = fill.fee;
        pnl = tpPnl(trade.side, entryPrice, fillPrice, fillQty, fee).net;
      } else {
        this.logger.error(
          `[SL PNL] ${trade.symbol}: nao foi possivel confirmar o fill real do fechamento na corretora -- usando preco estimado e calculo local sem taxas como fallback.`
        );
        pnl = this.calculatePnL(trade, exitPrice);
      }

      const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

      try {
        await this.tradesService.createExecution({
          tradeId: trade.id,
          type: ExecutionType.STOP_LOSS,
          price: fillPrice,
          quantity: fillQty,
          pnl,
          fee,
          percentOfPosition: 100,
          exchangeOrderId: trade.stopLossOrderId || undefined
        });
      } catch (e: any) {
        this.logger.warn(`[SL] Falha ao gravar execucao: ${e.message}`);
      }

      trade.status = 'CLOSED';
      trade.exitPrice = fillPrice as any;
      trade.pnl = totalPnl;
      trade.closeReason = reason;
      trade.closedAt = new Date();
      trade.binancePositionAmt = 0 as any;

      await this.tradesRepository.save(trade);

      this.logger.warn(`└─ Closed: ${this.formatQuantityWithUsdt(fillQty, fillPrice)} | P&L: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT`);

    } catch (error: any) {
      await this.escalateImmediately(trade, `Falha ao fechar a posicao via SL: ${error.message}`);
      this.logger.error(`Failed to close position: ${error.message}`);
    }
  }

  private calculatePnL(trade: Trade, exitPrice: number): number {
    const entryPrice = parseFloat(trade.entryPrice as any);
    const quantity = parseFloat(trade.quantity as any);

    if (trade.side === 'BUY') {
      return (exitPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - exitPrice) * quantity;
    }
  }
}
