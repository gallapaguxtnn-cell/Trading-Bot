import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, CloseReason } from '../strategies/trade.entity';
import { TradesService } from '../trades/trades.service';
import { ExecutionType } from '../trades/trade-execution.entity';
import { OrderFill, mapBybitFill, mapBinanceFill, mapCcxtFill, weightedAvgPrice, tpPnl, latestUpdatedAt, sumCommission, actualPercentOfPosition } from './fill.util';
import { decideTakeProfitClose } from './close-decision.util';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { OrderUpdateEvent } from '../binance-ws/dto/binance-ws-events.dto';
import { isPendingLimitEntry } from '../utils/trade-guards.util';
import {
  TP_MISSING_RETRY_LIMIT,
  parseTpMissingRetryCount,
  incrementTpMissingRetry,
  clearTpMissingRetry,
  shouldFallbackToMarket,
  computeTargetVsExecutedDiffPct,
  formatFallbackCloseDetail,
} from './take-profit-fallback.util';
import { floorToStep } from '../webhook/tp-planner.util';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { normalizeQuantity, roundPriceToTick } from '../common/exchange-precision.util';
import axios from 'axios';
import * as crypto from 'crypto';
import Decimal from 'decimal.js';

@Injectable()
export class TakeProfitService implements OnModuleInit {
  private readonly logger = new Logger(TakeProfitService.name);
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
    private bybitClient: BybitClientService,
    private binanceWs: BinanceWebSocketService,
    @Inject(forwardRef(() => PositionSyncService))
    private positionSyncService: PositionSyncService,
    private eventEmitter: EventEmitter2,
    private symbolRulesService: SymbolRulesService,
  ) {
    this.fallbackEnabled = process.env.BINANCE_WS_FALLBACK_ENABLED !== 'false';
  }

  onModuleInit() {
    if (this.binanceWs.isEnabled()) {
      this.logger.log('[WS] Take Profit WebSocket listeners registered');
    }
  }

  private formatQuantityWithUsdt(quantity: number, price: number): string {
    const usdt = quantity * price;
    return `${quantity.toFixed(4)} (~${usdt.toFixed(2)} USDT)`;
  }

  private async getMinQtyForSymbol(symbol: string, isTestnet: boolean, exchange: Exchange): Promise<number> {
    try {
      if (exchange === Exchange.BYBIT) {
        const rules = await this.bybitClient.getSymbolRules(isTestnet, symbol);
        return parseFloat(rules.minQty) || 0;
      }

      const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const response = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`);
      const symbolInfo = response.data.symbols.find((s: any) => s.symbol === symbol);
      const lotSizeFilter = symbolInfo?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      return lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0;
    } catch (error: any) {
      this.logger.warn(`[TP] Failed to fetch minQty for ${symbol}: ${error.message}`);
      return 0;
    }
  }

  private async getQtyStepForSymbol(symbol: string, isTestnet: boolean): Promise<string> {
    try {
      const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const response = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`);
      const symbolInfo = response.data.symbols.find((s: any) => s.symbol === symbol);
      const lotSizeFilter = symbolInfo?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      return lotSizeFilter ? lotSizeFilter.stepSize : '0.001';
    } catch (error: any) {
      this.logger.warn(`[TP] Failed to fetch qtyStep for ${symbol}: ${error.message}`);
      return '0.001';
    }
  }

  @OnEvent('binance.order.update')
  async handleOrderUpdate(event: OrderUpdateEvent) {
    if (event.orderType !== 'TAKE_PROFIT_MARKET' && event.orderType !== 'LIMIT') {
      return;
    }

    if (event.status !== 'FILLED') {
      return;
    }

    const trade = await this.tradesRepository.findOne({
      where: { status: 'OPEN' }
    });

    if (!trade || !trade.takeProfitOrderId) return;

    const tpOrderIds = trade.takeProfitOrderId.split('|');
    const matchingEntry = tpOrderIds.find(entry => entry.includes(event.orderId));

    if (!matchingEntry) return;

    this.logger.log(`[WS] Take Profit filled: ${event.symbol} - ${event.orderId}`);

    await this.checkTakeProfit(trade);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async monitorTakeProfit() {
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
        await this.checkTakeProfit(trade);
      } catch (error) {
        this.logger.error(`Error checking take-profit for trade ${trade.id}: ${error.message}`);
      } finally {
        this.processingTrades.delete(trade.id);
      }
    }
  }

  private async checkTakeProfit(trade: Trade) {
    if (isPendingLimitEntry(trade)) return;

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) return;

    const exchange = strategy.exchange || Exchange.BINANCE;
    const apiKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

    if (trade.takeProfitOrderId && trade.takeProfitOrderId.startsWith('BYBIT_TRADING_STOP')) {
      const positions = await this.bybitClient.getPositions(apiKey, apiSecret, strategy.isTestnet, trade.symbol);
      const position = positions.find(p =>
        p.symbol === trade.symbol &&
        ((trade.side === 'BUY' && p.side === 'Buy') || (trade.side === 'SELL' && p.side === 'Sell'))
      );
      if (!position || parseFloat(position.size) === 0) {
        this.logger.log(`[TAKE PROFIT EXECUTED] ${trade.symbol} - Position closed on Bybit`);
        await this.markTradeAsClosed(trade, 'TAKE_PROFIT', exchange, apiKey, apiSecret, strategy.isTestnet);
      }
      return;
    }

    if (trade.takeProfitOrderId && trade.takeProfitOrderId.includes(':')) {
      await this.checkExchangeTakeProfit(trade, strategy, exchange, apiKey, apiSecret);
      return;
    }

    const tp1 = this.calculateTakeProfit(trade, strategy, 1);
    const tp2 = this.calculateTakeProfit(trade, strategy, 2);
    const tp3 = this.calculateTakeProfit(trade, strategy, 3);

    if (!tp1 && !tp2 && !tp3) return;

    if (!shouldFallbackToMarket(trade.tpWarnings)) {
      const nextTpWarnings = incrementTpMissingRetry(trade.tpWarnings);
      await this.tradesRepository.update(trade.id, { tpWarnings: nextTpWarnings });
      this.eventEmitter.emit('limit.protection.resume', { tradeId: trade.id });
      this.logger.warn(
        `[TP] ${trade.symbol} sem ordens LIMIT de TP na corretora — solicitando recriacao ` +
        `(tentativa ${parseTpMissingRetryCount(nextTpWarnings)}/${TP_MISSING_RETRY_LIMIT})`
      );
      return;
    }

    const currentPrice = await this.getCurrentPrice(trade, strategy);
    if (!currentPrice) return;

    const tp1Qty = strategy.takeProfitQuantity1 || 33;
    const tp2Qty = strategy.takeProfitQuantity2 || 33;
    const lastTpLevel = trade.lastTpLevel || 0;

    const profitPercent = this.calculateProfitPercent(trade, currentPrice);
    const entryPrice = parseFloat(trade.entryPrice as any);

    if (lastTpLevel < 1 && tp1 && this.shouldTrigger(trade, currentPrice, tp1)) {
      this.logger.error(
        `[TP FALLBACK MARKET] ${trade.symbol} TP1 apos ${TP_MISSING_RETRY_LIMIT} tentativas sem LIMIT na corretora — ` +
        `alvo=${tp1.toFixed(8)} executado~=${currentPrice.toFixed(8)} diff=${computeTargetVsExecutedDiffPct(tp1, currentPrice).toFixed(4)}%`
      );
      this.logger.log(`├─ Entry: ${entryPrice.toFixed(2)} → Exit: ${currentPrice.toFixed(2)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
      trade.lastTpLevel = 1;
      trade.tpWarnings = clearTpMissingRetry(trade.tpWarnings) as any;
      trade.closeDetail = formatFallbackCloseDetail(tp1) as any;
      await this.closePosition(trade, strategy, currentPrice, 'TAKE_PROFIT_FALLBACK_MARKET', tp1Qty / 100, apiKey, apiSecret, 1);
    } else if (lastTpLevel < 2 && tp2 && this.shouldTrigger(trade, currentPrice, tp2)) {
      const closePercent = tp2Qty / (100 - tp1Qty);
      this.logger.error(
        `[TP FALLBACK MARKET] ${trade.symbol} TP2 apos ${TP_MISSING_RETRY_LIMIT} tentativas sem LIMIT na corretora — ` +
        `alvo=${tp2.toFixed(8)} executado~=${currentPrice.toFixed(8)} diff=${computeTargetVsExecutedDiffPct(tp2, currentPrice).toFixed(4)}%`
      );
      this.logger.log(`├─ Entry: ${entryPrice.toFixed(2)} → Exit: ${currentPrice.toFixed(2)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
      trade.lastTpLevel = 2;
      trade.tpWarnings = clearTpMissingRetry(trade.tpWarnings) as any;
      trade.closeDetail = formatFallbackCloseDetail(tp2) as any;
      await this.closePosition(trade, strategy, currentPrice, 'TAKE_PROFIT_FALLBACK_MARKET', closePercent, apiKey, apiSecret, 2);
    } else if (lastTpLevel < 3 && tp3 && this.shouldTrigger(trade, currentPrice, tp3)) {
      this.logger.error(
        `[TP FALLBACK MARKET] ${trade.symbol} TP3 apos ${TP_MISSING_RETRY_LIMIT} tentativas sem LIMIT na corretora — ` +
        `alvo=${tp3.toFixed(8)} executado~=${currentPrice.toFixed(8)} diff=${computeTargetVsExecutedDiffPct(tp3, currentPrice).toFixed(4)}%`
      );
      this.logger.log(`├─ Entry: ${entryPrice.toFixed(2)} → Exit: ${currentPrice.toFixed(2)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
      trade.lastTpLevel = 3;
      trade.tpWarnings = clearTpMissingRetry(trade.tpWarnings) as any;
      trade.closeDetail = formatFallbackCloseDetail(tp3) as any;
      await this.closePosition(trade, strategy, currentPrice, 'TAKE_PROFIT_FALLBACK_MARKET', 1.0, apiKey, apiSecret, 3);
    }
  }

  private async checkExchangeTakeProfit(trade: Trade, strategy: any, exchange: Exchange, apiKey: string, apiSecret: string) {
    const entries = trade.takeProfitOrderId!.split('|');
    const tp1Qty = strategy.takeProfitQuantity1 || 33;
    const tp2Qty = strategy.takeProfitQuantity2 || 33;

    const filledLevels = new Set<number>();
    const fillsByLevel = new Map<number, OrderFill>();
    const orderIdByLevel = new Map<number, string>();
    let anyActive = false;
    let allDone = true;

    for (const entry of entries) {
      const [levelStr, orderId] = entry.split(':');
      const level = parseInt(levelStr);
      orderIdByLevel.set(level, orderId);

      if ((trade.lastTpLevel || 0) >= level) {
        filledLevels.add(level);
        continue;
      }

      const fill = await this.fetchOrderFill(orderId, trade.symbol, exchange, apiKey, apiSecret, strategy.isTestnet);
      const status = fill?.status ?? null;

      this.logger.log(`[TP${level}] Order status for ${orderId}: ${status}`);

      if (status === 'FILLED' || status === 'Filled') {
        filledLevels.add(level);
        if (fill) fillsByLevel.set(level, fill);
        this.logger.log(`[TP${level}] Exchange order filled for ${trade.symbol} (orderId: ${orderId})`);
      } else if (status === 'NEW' || status === 'New' || status === 'PartiallyFilled') {
        anyActive = true;
        allDone = false;
        this.logger.log(`[TP${level}] Order is still active`);
      } else if (status === 'CANCELED' || status === 'EXPIRED' || status === 'Cancelled' || status === 'Deactivated') {
        this.logger.warn(`[TP${level}] Exchange order ${orderId} was ${status}`);
      } else if (status === null) {
        anyActive = true;
        allDone = false;
        this.logger.warn(`[TP${level}] Could not fetch order status, assuming still active`);
      } else {
        allDone = false;
        this.logger.warn(`[TP${level}] Unknown order status: ${status}`);
      }
    }

    const newlyFilled: number[] = [];
    for (const level of [1, 2, 3]) {
      if (filledLevels.has(level) && (trade.lastTpLevel || 0) < level) {
        newlyFilled.push(level);
      }
    }

    if (newlyFilled.length > 0) {
      const currentPrice = await this.getCurrentPrice(trade, strategy);
      let newQty = parseFloat(trade.quantity as any);
      let accumulatedPnl = parseFloat(trade.pnl as any) || 0;
      const entryPrice = parseFloat(trade.entryPrice as any);
      let highestProcessed = trade.lastTpLevel || 0;

      for (const l of newlyFilled) {
        const pct = l === 1 ? tp1Qty : l === 2 ? tp2Qty : (strategy.takeProfitQuantity3 || 34);
        const tpPrice = this.calculateTakeProfit(trade, strategy, l);

        const sumRemaining = [1, 2, 3]
          .filter(lvl => !filledLevels.has(lvl) || lvl > highestProcessed)
          .filter(lvl => lvl >= l)
          .reduce((sum, lvl) => sum + (lvl === 1 ? tp1Qty : lvl === 2 ? tp2Qty : (strategy.takeProfitQuantity3 || 34)), 0);
        const closePercent = sumRemaining > 0 ? pct / sumRemaining : pct / 100;
        const proportionalQty = newQty * closePercent;

        const fill = fillsByLevel.get(l);
        const priceSource = fill?.avgPrice != null ? 'exchange' : (tpPrice ? 'theoretical' : 'market');
        const fillPrice = (fill?.avgPrice ?? tpPrice ?? currentPrice) as number;
        const closedQty = fill?.executedQty ?? proportionalQty;
        const qtyBeforeThisClose = newQty;
        const { net } = tpPnl(trade.side, entryPrice, fillPrice, closedQty, fill?.fee);
        accumulatedPnl += net;
        newQty -= closedQty;
        highestProcessed = l;

        if (priceSource !== 'exchange') {
          this.logger.warn(`[TP${l}] sem preço da corretora, usando ${priceSource} (${fillPrice})`);
        }

        try {
          await this.tradesService.createExecution({
            tradeId: trade.id,
            type: l === 1 ? ExecutionType.TAKE_PROFIT_1 : l === 2 ? ExecutionType.TAKE_PROFIT_2 : ExecutionType.TAKE_PROFIT_3,
            price: fillPrice,
            quantity: closedQty,
            pnl: net,
            percentOfPosition: actualPercentOfPosition(closedQty, qtyBeforeThisClose, closePercent * 100),
            exchangeOrderId: orderIdByLevel.get(l),
          } as any);
        } catch (e) {
          this.logger.warn(`[TP${l}] falha ao gravar execução: ${e.message}`);
        }

        this.logger.log(`├─ TP${l} closed: ${this.formatQuantityWithUsdt(closedQty, fillPrice)} | P&L: ${net > 0 ? '+' : ''}${net.toFixed(4)} USDT`);
      }

      const totalConfiguredLevels = entries.length;
      const allLevelsFilled = filledLevels.size === totalConfiguredLevels;
      const positionFullyClosed = newQty <= 0.0001;

      this.logger.log(`[TP CHECK] Filled levels: ${Array.from(filledLevels).join(',')}, Total levels: ${totalConfiguredLevels}, Position closed: ${positionFullyClosed}`);

      let shouldClose = allLevelsFilled;
      let confirmedRemainingQty: number | null = null;

      if (!allLevelsFilled && positionFullyClosed) {
        const minQty = await this.getMinQtyForSymbol(trade.symbol, strategy.isTestnet, exchange);
        const exchangePositionSize = await this.positionSyncService.getPositionSize(
          exchange, trade.symbol, trade.side, apiKey, apiSecret, strategy.isTestnet
        );
        const decision = decideTakeProfitClose({ exchangePositionSize, minQty });
        shouldClose = decision.shouldClose;

        if (decision.reason === 'POSITION_STILL_OPEN') {
          confirmedRemainingQty = exchangePositionSize;
          this.logger.warn(
            `[TP] Posição ainda aberta na corretora (${exchangePositionSize} ${trade.symbol}) — trade mantido aberto (residual de arredondamento)`
          );
        } else if (decision.reason === 'QUERY_FAILED_FALLBACK_CLOSE') {
          this.logger.warn(
            `[TP] Falha ao confirmar posição de ${trade.symbol} na corretora — fechando com base no cálculo local (comportamento atual)`
          );
        }
      }

      if (allLevelsFilled || positionFullyClosed) {
        if (shouldClose) {
          const filledFills = newlyFilled.map(l => fillsByLevel.get(l));
          const realExit = weightedAvgPrice(filledFills);
          const realClosedAt = latestUpdatedAt(filledFills);

          trade.status = 'CLOSED';
          trade.exitPrice = (realExit ?? currentPrice) as any;
          trade.pnl = accumulatedPnl as any;
          trade.closeReason = `TAKE_PROFIT_${highestProcessed}` as any;
          trade.closedAt = realClosedAt ?? new Date();
          if (newlyFilled.length > 1) {
            const when = (realClosedAt ?? new Date()).toISOString().slice(11, 19);
            trade.closeDetail = `${newlyFilled.map(l => `TP${l}`).join('+')} @${when}` as any;
          }
          trade.binancePositionAmt = 0 as any;
          trade.lastTpLevel = highestProcessed;
          await this.tradesRepository.save(trade);
          this.logger.log(`└─ Trade fully closed via TP${highestProcessed} | Total P&L: ${accumulatedPnl > 0 ? '+' : ''}${accumulatedPnl.toFixed(2)} USDT`);

          await this.cancelTradeStopLoss(trade, exchange, apiKey, apiSecret, strategy.isTestnet);
          await this.cancelRemainingTpOrders(trade, filledLevels, exchange, apiKey, apiSecret, strategy.isTestnet);
        } else {
          const realQty = confirmedRemainingQty ?? newQty;
          trade.quantity = realQty as any;
          trade.lastTpLevel = highestProcessed;
          trade.pnl = accumulatedPnl as any;
          trade.binancePositionAmt = realQty as any;
          await this.tradesRepository.save(trade);

          if (strategy.moveSLToBreakeven || strategy.breakAgain) {
            await this.positionSyncService.checkBreakAgain(trade, undefined, strategy, apiKey, apiSecret);
          }

          if (exchange === Exchange.BINANCE && trade.stopLossOrderId) {
            await this.adjustStopLossForRemainingQty(trade, strategy, exchange, apiKey, apiSecret, realQty);
          }
        }
      } else {
        trade.quantity = newQty as any;
        trade.lastTpLevel = highestProcessed;
        trade.pnl = accumulatedPnl as any;
        trade.binancePositionAmt = newQty as any;
        await this.tradesRepository.save(trade);
        this.logger.log(`├─ Remaining: ${this.formatQuantityWithUsdt(newQty, currentPrice)}`);

        // Check if breakeven or break again should be triggered
        if (strategy.moveSLToBreakeven || strategy.breakAgain) {
          await this.positionSyncService.checkBreakAgain(trade, undefined, strategy, apiKey, apiSecret);
        }

        if (exchange === Exchange.BINANCE && trade.stopLossOrderId) {
          await this.adjustStopLossForRemainingQty(trade, strategy, exchange, apiKey, apiSecret, newQty);
        }

        if (exchange === Exchange.BYBIT && trade.stopLossOrderId) {
          this.logger.log(`[BYBIT] SL adjustment not needed - Bybit manages position-level SL automatically`);
        }
      }
      return;
    }

    if (allDone && !anyActive) {
      this.logger.warn(`[TP] All exchange TP orders inactive for ${trade.symbol}, switching to manual monitoring`);
      trade.takeProfitOrderId = null;
      await this.tradesRepository.save(trade);
    }
  }

  private async cancelRemainingTpOrders(
    trade: Trade,
    filledLevels: Set<number>,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (!trade.takeProfitOrderId) return;

    const entries = trade.takeProfitOrderId.split('|');

    for (const entry of entries) {
      const [levelStr, orderId] = entry.split(':');
      const level = parseInt(levelStr);

      if (filledLevels.has(level)) {
        this.logger.log(`[TP${level}] Order ${orderId} already filled, skipping cancel`);
        continue;
      }

      try {
        if (exchange === Exchange.BINANCE) {
          await this.cancelBinanceOrder(orderId, trade.symbol, apiKey, apiSecret, isTestnet);
          this.logger.log(`[TP${level}] Cancelled unfilled TP order ${orderId}`);
        } else if (exchange === Exchange.BYBIT) {
          await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, orderId);
          this.logger.log(`[TP${level}] Cancelled unfilled Bybit TP order ${orderId}`);
        }
      } catch (e: any) {
        const isNotFoundError = e.response?.data?.code === -2011 || e.response?.data?.retCode === 110001;
        if (!isNotFoundError) {
          this.logger.warn(`[TP${level}] Failed to cancel TP order ${orderId}: ${e.message}`);
        }
      }
    }
  }

  private async cancelTradeStopLoss(
    trade: Trade,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (!trade.stopLossOrderId) return;

    try {
      if (exchange === Exchange.BYBIT) {
        if (trade.stopLossOrderId.startsWith('BYBIT_TRADING_STOP')) {
          const bybitSide = trade.side === 'BUY' ? 'Buy' : 'Sell';
          const strategy = await this.strategiesService.findOne(trade.strategyId);
          if (strategy) {
            await this.bybitClient.clearTradingStop(
              apiKey,
              apiSecret,
              isTestnet,
              trade.symbol,
              bybitSide,
              strategy.hedgeMode
            );
            this.logger.log(`[SL] Cleared Bybit trading stop for ${trade.symbol} after all TPs filled`);
          }
        } else {
          await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, trade.stopLossOrderId);
          this.logger.log(`[SL] Cancelled Bybit SL order ${trade.stopLossOrderId} after all TPs filled`);
        }
      } else if (exchange === Exchange.BINANCE) {
        await this.cancelBinanceOrderOrAlgo(trade.stopLossOrderId, trade.symbol, apiKey, apiSecret, isTestnet);
        this.logger.log(`[SL] Cancelled SL order ${trade.stopLossOrderId} after all TPs filled`);
      }
    } catch (e: any) {
      this.logger.warn(`[SL] Failed to cancel SL order ${trade.stopLossOrderId}: ${e.message}`);
    }
  }

  private async adjustStopLossForRemainingQty(
    trade: Trade,
    strategy: any,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    remainingQty: number
  ): Promise<void> {
    if (!trade.stopLossOrderId) return;

    try {
      let stopPrice: number;

      if (trade.currentStopLoss) {
        stopPrice = parseFloat(trade.currentStopLoss as any);
        this.logger.log(`[SL ADJUST] Using currentStopLoss: ${stopPrice} (Break Even/Break Again active)`);
      } else {
        const fetchedStopPrice = await this.getBinanceOrderStopPrice(
          trade.stopLossOrderId, trade.symbol, apiKey, apiSecret, strategy.isTestnet
        );

        if (!fetchedStopPrice) {
          this.logger.warn(`[SL ADJUST] Could not get stopPrice for SL ${trade.stopLossOrderId}, skipping adjustment`);
          return;
        }

        stopPrice = fetchedStopPrice;
        this.logger.log(`[SL ADJUST] Using original SL price from exchange: ${stopPrice}`);
      }

      await this.cancelBinanceOrder(trade.stopLossOrderId, trade.symbol, apiKey, apiSecret, strategy.isTestnet);

      const newSlId = await this.createBinanceStopLossOrder(
        trade.symbol,
        trade.side as 'BUY' | 'SELL',
        remainingQty,
        stopPrice,
        apiKey,
        apiSecret,
        strategy.isTestnet,
        strategy.hedgeMode
      );

      trade.stopLossOrderId = newSlId;
      await this.tradesRepository.save(trade);

      this.logger.log(`[SL ADJUST] Adjusted SL for trade ${trade.id}: new qty=${remainingQty}, price=${stopPrice}, orderId=${newSlId}`);
    } catch (e: any) {
      this.logger.warn(`[SL ADJUST] Failed to adjust SL for trade ${trade.id}: ${e.message}`);
    }
  }

  private async cancelBinanceOrder(
    orderId: string,
    symbol: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    await BinanceRequestUtil.delete(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
  }

  private async cancelBinanceAlgoOrder(
    algoId: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    // NEW ALGO ORDER API - Cancel conditional orders (STOP_MARKET, etc)
    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const params = new URLSearchParams();
    params.append('algoId', algoId);
    params.append('timestamp', Date.now().toString());

    const queryString = params.toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    await BinanceRequestUtil.delete(`${baseUrl}/fapi/v1/algoOrder?${queryString}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
  }

  private async cancelBinanceOrderOrAlgo(
    orderId: string,
    symbol: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    // Smart cancellation: Try Algo Order first (new orders), fallback to regular order (old orders)
    try {
      // Try as Algo Order first (STOP_MARKET conditional orders created after Dec 2025)
      await this.cancelBinanceAlgoOrder(orderId, apiKey, apiSecret, isTestnet);
      this.logger.debug(`[CANCEL] Successfully cancelled Algo Order ${orderId}`);
    } catch (algoError: any) {
      const algoErrorCode = algoError.response?.data?.code;

      // If not found as Algo Order, try as regular order (backwards compatibility)
      if (algoErrorCode === -4143 || algoErrorCode === -1102) {
        try {
          await this.cancelBinanceOrder(orderId, symbol, apiKey, apiSecret, isTestnet);
          this.logger.debug(`[CANCEL] Successfully cancelled regular order ${orderId}`);
        } catch (regularError: any) {
          // If both fail, throw the original error
          throw regularError;
        }
      } else {
        // Other algo order errors, rethrow
        throw algoError;
      }
    }
  }

  private async getBinanceOrderStopPrice(
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

      const response = await BinanceRequestUtil.get(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });

      return parseFloat(response.data.stopPrice) || null;
    } catch {
      return null;
    }
  }

  private async createBinanceStopLossOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    hedgeMode: boolean = false
  ): Promise<string> {
    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const rules = await this.symbolRulesService.getSymbolRules(symbol, isTestnet, Exchange.BINANCE);
    const qty = normalizeQuantity(quantity, rules.qtyStep, rules.minQty);

    if (qty === '0') {
      throw new Error(
        `Normalized quantity for ${symbol} rounded to 0 (raw=${quantity}, step=${rules.qtyStep}, minQty=${rules.minQty}). Aborting SL order.`
      );
    }

    const triggerPrice = roundPriceToTick(stopPrice, rules.priceTick);

    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('side', closeSide);
    params.append('algoType', 'CONDITIONAL');
    params.append('type', 'STOP_MARKET');
    params.append('quantity', qty);
    params.append('triggerPrice', triggerPrice);
    params.append('workingType', 'MARK_PRICE');

    if (hedgeMode) {
      const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
      params.append('positionSide', positionSide);
    } else {
      params.append('reduceOnly', 'true');
    }

    params.append('timestamp', Date.now().toString());

    const queryString = params.toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    // NEW ALGO ORDER API (mandatory since 2025-12-09)
    const response = await BinanceRequestUtil.post(
      `${baseUrl}/fapi/v1/algoOrder`,
      `${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data.algoId.toString();
  }

  private async cancelTradeSpecificTpOrders(
    trade: Trade,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (!trade.takeProfitOrderId) return;

    const entries = trade.takeProfitOrderId.split('|');
    for (const entry of entries) {
      const orderId = entry.includes(':') ? entry.split(':')[1] : entry;
      if (!orderId || orderId === 'null' || orderId === 'undefined') continue;

      try {
        if (exchange === Exchange.BINANCE) {
          await this.cancelBinanceOrder(orderId, trade.symbol, apiKey, apiSecret, isTestnet);
        } else if (exchange === Exchange.BYBIT) {
          await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, orderId);
        }
        this.logger.log(`[TP] Cancelled TP order ${orderId}`);
      } catch (e: any) {
        this.logger.warn(`[TP] Failed to cancel TP order ${orderId}: ${e.message}`);
      }
    }
  }

  private async fetchOrderFill(
    orderId: string,
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<OrderFill | null> {
    try {
      if (exchange === Exchange.BYBIT) {
        let orderInfo = await this.bybitClient.getOrderInfo(apiKey, apiSecret, isTestnet, symbol, orderId);

        if (!orderInfo) {
          orderInfo = await this.bybitClient.getOrderHistory(apiKey, apiSecret, isTestnet, symbol, orderId);
        }

        return mapBybitFill(orderInfo as unknown as Record<string, unknown> | null);
      }

      const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

      const response = await BinanceRequestUtil.get(
        `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      const fill = mapBinanceFill(response.data as Record<string, unknown>);
      if (fill && fill.fee == null && fill.status && /FILLED/i.test(fill.status)) {
        const fee = await this.fetchBinanceCommission(orderId, symbol, apiKey, apiSecret, isTestnet);
        if (fee != null) fill.fee = fee;
      }
      return fill;
    } catch (error) {
      this.logger.warn(`Failed to fetch order fill (${orderId}): ${error.message}`);
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
    } catch (error) {
      this.logger.warn(`Failed to fetch Binance commission (${orderId}): ${error.message}`);
      return null;
    }
  }

  private async checkOrderStatus(
    orderId: string,
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<string | null> {
    return (await this.fetchOrderFill(orderId, symbol, exchange, apiKey, apiSecret, isTestnet))?.status ?? null;
  }

  private async markTradeAsClosed(
    trade: Trade,
    reason: CloseReason,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    orderId?: string
  ): Promise<void> {
    let fill: OrderFill | null = null;
    if (orderId) {
      fill = await this.fetchOrderFill(orderId, trade.symbol, exchange, apiKey, apiSecret, isTestnet);
    }

    const lastPrice = await this.getLastTradePrice(trade.symbol, exchange, apiKey, apiSecret, isTestnet);
    const marketPrice = lastPrice || await this.getCurrentPrice(trade, { exchange, isTestnet } as any);

    const exitPrice = fill?.avgPrice ?? marketPrice;
    const closeQty = fill?.executedQty ?? parseFloat(trade.quantity as any);
    const pnl = fill?.avgPrice != null
      ? tpPnl(trade.side, parseFloat(trade.entryPrice as any), exitPrice, closeQty, fill?.fee).net
      : this.calculatePnL(trade, exitPrice, 1.0);
    const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

    trade.status = 'CLOSED';
    trade.exitPrice = exitPrice as any;
    trade.pnl = totalPnl as any;
    trade.closeReason = reason;
    trade.closedAt = fill?.updatedAt ?? new Date();
    trade.binancePositionAmt = 0 as any;

    await this.tradesRepository.save(trade);

    this.logger.log(`[CLOSED] ${trade.symbol} via ${reason} | P&L: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT`);
  }

  private async getLastTradePrice(
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<number | null> {
    try {
      if (exchange === Exchange.BYBIT) {
        return await this.bybitClient.getLastTradePrice(apiKey, apiSecret, isTestnet, symbol);
      }

      const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&limit=1&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

      const response = await BinanceRequestUtil.get(
        `${baseUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      if (response.data && response.data.length > 0) {
        return parseFloat(response.data[0].price);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private calculateTakeProfit(trade: Trade, strategy: any, level: number): number | null {
    let tpPercent: number | null = null;

    if (level === 1) tpPercent = strategy.takeProfitPercentage1;
    else if (level === 2) tpPercent = strategy.takeProfitPercentage2;
    else if (level === 3) tpPercent = strategy.takeProfitPercentage3;

    if (!tpPercent) return null;

    const tpDecimal = tpPercent / 100;
    const entryPrice = parseFloat(trade.entryPrice as any);

    if (trade.side === 'BUY') {
      return entryPrice * (1 + tpDecimal);
    } else {
      return entryPrice * (1 - tpDecimal);
    }
  }

  private shouldTrigger(trade: Trade, currentPrice: number, tpPrice: number): boolean {
    if (trade.side === 'BUY') {
      return currentPrice >= tpPrice;
    } else {
      return currentPrice <= tpPrice;
    }
  }

  private calculateProfitPercent(trade: Trade, currentPrice: number): number {
    const entryPrice = parseFloat(trade.entryPrice as any);

    if (trade.side === 'BUY') {
      return ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - currentPrice) / entryPrice) * 100;
    }
  }

  private async getCurrentPrice(trade: Trade, strategy: any): Promise<number> {
    try {
      const exchange = strategy.exchange || Exchange.BINANCE;

      if (exchange === Exchange.BYBIT) {
        return await this.bybitClient.getCurrentPrice(strategy.isTestnet, trade.symbol);
      }

      if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const response = await BinanceRequestUtil.get(
          `${this.BINANCE_TESTNET_URL}/fapi/v1/ticker/price?symbol=${trade.symbol}`
        );
        return parseFloat(response.data.price);
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
    closePercent: number,
    apiKey: string,
    apiSecret: string,
    executionLevel: 1 | 2 | 3
  ) {
    try {
      const exchange = strategy.exchange || Exchange.BINANCE;
      const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const quantity = parseFloat(trade.quantity as any);
      let closeQuantity = quantity * closePercent;
      let ccxtFill: OrderFill | null = null;

      if (exchange === Exchange.BYBIT) {
        const rules = await this.bybitClient.getSymbolRules(strategy.isTestnet, trade.symbol);
        const minQty = new Decimal(rules.minQty);
        const stepSize = new Decimal(rules.qtyStep);

        const normalizedQty = floorToStep(new Decimal(closeQuantity), stepSize);

        if (normalizedQty.lessThan(minQty)) {
          const normalizedTotalQty = floorToStep(new Decimal(quantity), stepSize);

          if (closePercent < 1.0) {
            this.logger.warn(
              `[BYBIT TP] Fatia calculada ${closeQuantity.toFixed(8)} < minQty ${minQty.toFixed()}. ` +
              `Pulando TP${executionLevel} sem fechar nada — quantidade fica integral para o proximo nivel.`
            );
            await this.tradesRepository.update(trade.id, { lastTpLevel: executionLevel });
            return;
          }

          if (normalizedTotalQty.lessThan(minQty)) {
            this.logger.error(
              `[BYBIT TP] Position quantity ${quantity} too small to close. ` +
              `Normalized: ${normalizedTotalQty.toFixed()}, MinQty: ${minQty.toFixed()}. Marking trade as closed.`
            );

            await this.tradesRepository.save({
              ...trade,
              status: 'CLOSED',
              exitPrice: exitPrice as any,
              closeReason: 'DUST_AMOUNT' as any,
              closedAt: new Date(),
              quantity: 0 as any,
              excludeFromStats: true,
            });

            this.logger.log(`[BYBIT TP] Trade ${trade.id.substring(0, 8)} closed due to dust amount (< minQty)`);
            return;
          }

          closeQuantity = normalizedTotalQty.toNumber();
        } else {
          closeQuantity = normalizedQty.toNumber();
        }

        const originalSide = trade.side === 'BUY' ? 'Buy' : 'Sell';
        const positionIdx = await this.bybitClient.getPositionIdx(
          apiKey, apiSecret, strategy.isTestnet, trade.symbol, originalSide, strategy.hedgeMode
        );

        const bybitSide = closeSide === 'BUY' ? 'Buy' : 'Sell';
        const closeQtyStr = floorToStep(new Decimal(closeQuantity), stepSize).toFixed();
        const bybitOrder = await this.bybitClient.createOrder(
          apiKey,
          apiSecret,
          strategy.isTestnet,
          {
            symbol: trade.symbol,
            side: bybitSide,
            orderType: 'Market',
            qty: closeQtyStr,
            positionIdx,
            reduceOnly: true,
            hedgeMode: strategy.hedgeMode
          }
        );
        this.logger.log(`[BYBIT] Closed ${closeQtyStr} ${trade.symbol} via ${reason}`);

        if (bybitOrder?.orderId) {
          await new Promise(resolve => setTimeout(resolve, 500));
          ccxtFill = await this.fetchOrderFill(bybitOrder.orderId, trade.symbol, Exchange.BYBIT, apiKey, apiSecret, strategy.isTestnet);
        }
      } else if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const stepSize = await this.getQtyStepForSymbol(trade.symbol, strategy.isTestnet);
        const normalizedQty = floorToStep(new Decimal(closeQuantity), new Decimal(stepSize || '0.001'));
        closeQuantity = normalizedQty.toNumber();

        const baseURL = this.BINANCE_TESTNET_URL;
        const params = new URLSearchParams();
        params.append('symbol', trade.symbol);
        params.append('side', closeSide);
        params.append('type', 'MARKET');
        params.append('quantity', normalizedQty.toFixed());

        if (strategy.hedgeMode) {
          const positionSide = trade.side === 'BUY' ? 'LONG' : 'SHORT';
          params.append('positionSide', positionSide);
        }

        params.append('timestamp', Date.now().toString());

        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
        const body = `${queryString}&signature=${signature}`;

        const response = await BinanceRequestUtil.post(`${baseURL}/fapi/v1/order`, body, {
          headers: {
            'X-MBX-APIKEY': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        ccxtFill = mapBinanceFill(response.data as Record<string, unknown>);
        this.logger.log(`[BINANCE] Closed ${(closePercent * 100).toFixed(0)}% of ${trade.symbol} via ${reason}`);
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

        const closeOrder = await exchangeInstance.createMarketOrder(trade.symbol, closeSide.toLowerCase(), closeQuantity, ccxtParams);
        ccxtFill = mapCcxtFill(closeOrder as unknown as Record<string, unknown>);
        this.logger.log(`[CLOSED ${(closePercent * 100).toFixed(0)}%] ${trade.symbol} via ${reason}`);
      }

      const fillPrice = ccxtFill?.avgPrice ?? exitPrice;
      const fillQty = ccxtFill?.executedQty ?? closeQuantity;
      const pnl = ccxtFill?.avgPrice != null
        ? tpPnl(trade.side, parseFloat(trade.entryPrice as any), fillPrice, fillQty, ccxtFill?.fee).net
        : this.calculatePnL(trade, exitPrice, closePercent);
      const closedAtReal = ccxtFill?.updatedAt ?? new Date();

      const executionType = executionLevel === 1 ? ExecutionType.TAKE_PROFIT_1 :
                           executionLevel === 2 ? ExecutionType.TAKE_PROFIT_2 :
                           ExecutionType.TAKE_PROFIT_3;

      await this.tradesService.createExecution({
        tradeId: trade.id,
        type: executionType,
        price: fillPrice,
        quantity: fillQty,
        pnl: pnl,
        percentOfPosition: actualPercentOfPosition(fillQty, quantity, closePercent * 100),
        exchangeOrderId: undefined
      } as any);

      if (closePercent >= 1.0) {
        trade.status = 'CLOSED';
        trade.exitPrice = fillPrice as any;
        trade.pnl = pnl as any;
        trade.closeReason = reason;
        trade.closedAt = closedAtReal;
        trade.binancePositionAmt = 0 as any;

        await this.tradesRepository.save(trade);

        await this.cancelTradeStopLoss(trade, exchange, apiKey, apiSecret, strategy.isTestnet);

        this.logger.log(`├─ Closed: ${this.formatQuantityWithUsdt(fillQty, fillPrice)} (100%)`);
        this.logger.log(`└─ P&L: ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      } else {
        const remainingQuantity = quantity * (1 - closePercent);
        trade.quantity = remainingQuantity as any;
        const currentPnl = parseFloat(trade.pnl as any) || 0;
        trade.pnl = (currentPnl + pnl) as any;
        trade.exitPrice = fillPrice as any;
        trade.binancePositionAmt = remainingQuantity as any;

        await this.tradesRepository.save(trade);

        if (exchange === Exchange.BINANCE && trade.stopLossOrderId) {
          await this.adjustStopLossForRemainingQty(trade, strategy, exchange, apiKey, apiSecret, remainingQuantity);
        }

        this.logger.log(`├─ Closed: ${this.formatQuantityWithUsdt(closeQuantity, exitPrice)} (${(closePercent * 100).toFixed(0)}%)`);
        this.logger.log(`├─ Remaining: ${this.formatQuantityWithUsdt(remainingQuantity, exitPrice)}`);
        this.logger.log(`└─ P&L: ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      }

    } catch (error) {
      this.logger.error(`Failed to close position: ${error.message}`);
    }
  }

  private calculatePnL(trade: Trade, exitPrice: number, closePercent: number): number {
    const entryPrice = parseFloat(trade.entryPrice as any);
    const tradeQuantity = parseFloat(trade.quantity as any);
    const quantity = tradeQuantity * closePercent;

    if (trade.side === 'BUY') {
      return (exitPrice - entryPrice) * quantity;
    } else {
      return (entryPrice - exitPrice) * quantity;
    }
  }
}
