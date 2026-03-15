import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, CloseReason } from '../strategies/trade.entity';
import { TradesService } from '../trades/trades.service';
import { ExecutionType } from '../trades/trade-execution.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class StopLossService {
  private readonly logger = new Logger(StopLossService.name);
  private readonly BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
  private readonly BINANCE_MAINNET_URL = 'https://fapi.binance.com';

  constructor(
    @InjectRepository(Trade)
    private tradesRepository: Repository<Trade>,
    @Inject(forwardRef(() => TradesService))
    private tradesService: TradesService,
    private strategiesService: StrategiesService,
    private exchangeService: ExchangeService,
    private bybitClient: BybitClientService,
  ) {}

  private formatQuantityWithUsdt(quantity: number, price: number): string {
    const usdt = quantity * price;
    return `${quantity.toFixed(4)} (~${usdt.toFixed(2)} USDT)`;
  }

  @Cron('*/1 * * * * *')
  async monitorStopLoss() {
    const openTrades = await this.tradesRepository.find({ where: { status: 'OPEN' } });

    if (openTrades.length === 0) return;

    for (const trade of openTrades) {
      try {
        await this.checkStopLoss(trade);
      } catch (error) {
        this.logger.error(`Error checking stop-loss for trade ${trade.id}: ${error.message}`);
      }
    }
  }

  private async checkStopLoss(trade: Trade) {
    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) return;

    const exchange = strategy.exchange || Exchange.BINANCE;
    const apiKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

    if (trade.stopLossOrderId && trade.stopLossOrderId.trim() !== '') {
      if (trade.stopLossOrderId.startsWith('BYBIT_TRADING_STOP')) {
        const positions = await this.bybitClient.getPositions(apiKey, apiSecret, strategy.isTestnet, trade.symbol);
        const position = positions.find(p =>
          p.symbol === trade.symbol &&
          ((trade.side === 'BUY' && p.side === 'Buy') || (trade.side === 'SELL' && p.side === 'Sell'))
        );

        if (!position || parseFloat(position.size) === 0) {
          this.logger.log(`[STOP LOSS EXECUTED] ${trade.symbol} - Position closed on Bybit`);
          await this.markTradeAsClosed(trade, 'STOP_LOSS', exchange, apiKey, apiSecret, strategy.isTestnet);
          return;
        }
        return;
      }

      const orderStatus = await this.checkOrderStatus(
        trade.stopLossOrderId,
        trade.symbol,
        exchange,
        apiKey,
        apiSecret,
        strategy.isTestnet
      );

      if (orderStatus === 'FILLED' || orderStatus === 'Filled') {
        this.logger.log(`[STOP LOSS EXECUTED] ${trade.symbol} - Order was filled`);
        await this.markTradeAsClosed(trade, 'STOP_LOSS', exchange, apiKey, apiSecret, strategy.isTestnet);
        return;
      } else if (orderStatus === 'CANCELED' || orderStatus === 'EXPIRED' || orderStatus === 'Cancelled' || orderStatus === 'Deactivated') {
        this.logger.warn(`[STOP LOSS] Order ${trade.stopLossOrderId} was ${orderStatus}, attempting to recreate SL`);

        const recreated = await this.recreateStopLoss(trade, strategy, exchange, apiKey, apiSecret);
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

    if (!strategy.stopLossPercentage) return;

    const currentPrice = await this.getCurrentPrice(trade, strategy);
    if (!currentPrice) return;

    const stopLossPrice = this.calculateStopLoss(trade, strategy);

    const shouldTrigger =
      (trade.side === 'BUY' && currentPrice <= stopLossPrice) ||
      (trade.side === 'SELL' && currentPrice >= stopLossPrice);

    if (shouldTrigger) {
      const entryPrice = parseFloat(trade.entryPrice as any);
      const lossPercent = trade.side === 'BUY'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      this.logger.warn(`[STOP-LOSS TRIGGERED] ${trade.symbol}`);
      this.logger.warn(`├─ Entry: ${entryPrice.toFixed(2)} → Exit: ${currentPrice.toFixed(2)} (${lossPercent.toFixed(2)}%)`);
      this.logger.warn(`└─ SL Price: ${stopLossPrice.toFixed(2)}`);
      await this.closePosition(trade, strategy, currentPrice, 'STOP_LOSS', apiKey, apiSecret);
    }
  }

  private async recreateStopLoss(
    trade: Trade,
    strategy: any,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string
  ): Promise<boolean> {
    try {
      if (exchange !== Exchange.BINANCE) return false;
      if (!strategy.stopLossPercentage || strategy.stopLossPercentage <= 0) return false;

      const baseUrl = strategy.isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const timestamp = Date.now();
      const positionSide = strategy.hedgeMode
        ? (trade.side === 'BUY' ? 'LONG' : 'SHORT')
        : 'BOTH';

      const params = new URLSearchParams();
      params.append('symbol', trade.symbol);
      params.append('timestamp', timestamp.toString());
      const sig = crypto.createHmac('sha256', apiSecret).update(params.toString()).digest('hex');

      const resp = await axios.get(
        `${baseUrl}/fapi/v2/positionRisk?${params.toString()}&signature=${sig}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      const position = (resp.data as any[]).find(p =>
        p.symbol === trade.symbol && p.positionSide === positionSide && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!position) {
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

      const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const qty = remainingQty.toFixed(3);

      const orderParams = new URLSearchParams();
      orderParams.append('symbol', trade.symbol);
      orderParams.append('side', closeSide);
      orderParams.append('algoType', 'CONDITIONAL');
      orderParams.append('type', 'STOP_MARKET');
      orderParams.append('quantity', qty);
      orderParams.append('triggerPrice', stopPrice.toFixed(2));  // ALGO API uses triggerPrice, not stopPrice
      orderParams.append('workingType', 'MARK_PRICE');

      if (strategy.hedgeMode) {
        orderParams.append('positionSide', positionSide);
      } else {
        orderParams.append('reduceOnly', 'true');
      }

      orderParams.append('timestamp', Date.now().toString());
      const orderSig = crypto.createHmac('sha256', apiSecret).update(orderParams.toString()).digest('hex');

      // NEW ALGO ORDER API (mandatory since 2025-12-09)
      const orderResp = await axios.post(
        `${baseUrl}/fapi/v1/algoOrder`,
        `${orderParams.toString()}&signature=${orderSig}`,
        { headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const newSlId = orderResp.data.algoId.toString();
      trade.stopLossOrderId = newSlId;
      await this.tradesRepository.save(trade);

      this.logger.log(`[SL RECREATE] Successfully recreated SL for ${trade.symbol}: orderId=${newSlId}, stopPrice=${stopPrice.toFixed(2)}`);
      return true;
    } catch (error: any) {
      this.logger.error(`[SL RECREATE] Failed to recreate SL: ${error.message}`);
      return false;
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
    try {
      if (exchange === Exchange.BYBIT) {
        let orderInfo = await this.bybitClient.getOrderInfo(apiKey, apiSecret, isTestnet, symbol, orderId);

        if (!orderInfo) {
          orderInfo = await this.bybitClient.getOrderHistory(apiKey, apiSecret, isTestnet, symbol, orderId);
        }

        return orderInfo?.orderStatus || null;
      }

      const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const timestamp = Date.now();

      // Try Algo Order first (for Stop Loss orders created with new API)
      try {
        const algoQueryString = `algoId=${orderId}&timestamp=${timestamp}`;
        const algoSignature = crypto.createHmac('sha256', apiSecret).update(algoQueryString).digest('hex');

        const algoResponse = await axios.get(
          `${baseUrl}/fapi/v1/algoOrder?${algoQueryString}&signature=${algoSignature}`,
          { headers: { 'X-MBX-APIKEY': apiKey } }
        );

        // Algo Order status mapping: NEW -> active, CANCELLED -> cancelled, TRIGGERED -> filled
        const algoStatus = algoResponse.data.algoStatus;
        if (algoStatus === 'WORKING') return 'NEW';
        if (algoStatus === 'CANCELLED') return 'CANCELED';
        if (algoStatus === 'FILLED') return 'FILLED';
        return algoStatus;
      } catch (algoError: any) {
        const errorCode = algoError.response?.data?.code;

        // If algo order not found (-4143, -1102), try regular order
        if (errorCode === -4143 || errorCode === -1102 || errorCode === -2013) {
          const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${Date.now()}`;
          const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

          const response = await axios.get(
            `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
            { headers: { 'X-MBX-APIKEY': apiKey } }
          );

          return response.data.status;
        }

        throw algoError;
      }
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
    isTestnet: boolean
  ): Promise<void> {
    if (!trade.takeProfitOrderId) return;

    if (trade.takeProfitOrderId.startsWith('BYBIT_TRADING_STOP')) {
      const bybitSide = trade.side === 'BUY' ? 'Buy' : 'Sell';
      const strategy = await this.strategiesService.findOne(trade.strategyId);
      if (strategy) {
        try {
          await this.bybitClient.clearTradingStop(
            apiKey,
            apiSecret,
            isTestnet,
            trade.symbol,
            bybitSide,
            strategy.hedgeMode
          );
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
        if (exchange === Exchange.BINANCE) {
          const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
          const timestamp = Date.now();
          const queryString = `symbol=${trade.symbol}&orderId=${orderId}&timestamp=${timestamp}`;
          const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

          await axios.delete(`${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
          });
        } else if (exchange === Exchange.BYBIT) {
          await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, orderId);
        }
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
    isTestnet: boolean
  ): Promise<void> {
    const exitPrice = await this.getLastTradePrice(trade.symbol, exchange, apiKey, apiSecret, isTestnet);
    const currentPrice = exitPrice || await this.getCurrentPrice(trade, { exchange, isTestnet } as any);

    await this.cancelTradeSpecificTpOrders(trade, exchange, apiKey, apiSecret, isTestnet);

    const pnl = this.calculatePnL(trade, currentPrice);
    const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

    trade.status = 'CLOSED';
    trade.exitPrice = currentPrice as any;
    trade.pnl = totalPnl;
    trade.closeReason = reason;
    trade.closedAt = new Date();
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

      const response = await axios.get(
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
        return await this.bybitClient.getCurrentPrice(strategy.isTestnet, trade.symbol);
      }

      if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const response = await axios.get(
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
    apiKey: string,
    apiSecret: string
  ) {
    try {
      const exchange = strategy.exchange || Exchange.BINANCE;
      const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const quantity = parseFloat(trade.quantity as any);

      if (exchange === Exchange.BYBIT) {
        const originalSide = trade.side === 'BUY' ? 'Buy' : 'Sell';
        const positionIdx = await this.bybitClient.getPositionIdx(
          apiKey, apiSecret, strategy.isTestnet, trade.symbol, originalSide, strategy.hedgeMode
        );

        const bybitSide = closeSide === 'BUY' ? 'Buy' : 'Sell';
        await this.bybitClient.createOrder(
          apiKey,
          apiSecret,
          strategy.isTestnet,
          {
            symbol: trade.symbol,
            side: bybitSide,
            orderType: 'Market',
            qty: quantity.toFixed(3),
            positionIdx,
            reduceOnly: true,
            hedgeMode: strategy.hedgeMode
          }
        );
        this.logger.warn(`[BYBIT] Closed ${trade.symbol} via ${reason}`);
      } else if (strategy.isTestnet && exchange === Exchange.BINANCE) {
        const baseURL = this.BINANCE_TESTNET_URL;
        const params = new URLSearchParams();
        params.append('symbol', trade.symbol);
        params.append('side', closeSide);
        params.append('type', 'MARKET');
        params.append('quantity', quantity.toFixed(3));

        if (strategy.hedgeMode) {
          const positionSide = trade.side === 'BUY' ? 'LONG' : 'SHORT';
          params.append('positionSide', positionSide);
        }

        params.append('timestamp', Date.now().toString());

        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
        const body = `${queryString}&signature=${signature}`;

        await axios.post(`${baseURL}/fapi/v1/order`, body, {
          headers: {
            'X-MBX-APIKEY': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

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

        await exchangeInstance.createMarketOrder(trade.symbol, closeSide.toLowerCase(), quantity, ccxtParams);
        this.logger.warn(`[CLOSED] ${trade.symbol} via ${reason}`);
      }

      await this.cancelTradeSpecificTpOrders(trade, exchange, apiKey, apiSecret, strategy.isTestnet);

      const pnl = this.calculatePnL(trade, exitPrice);
      const totalPnl = (parseFloat(trade.pnl as any) || 0) + pnl;

      // Save execution record for stop loss
      await this.tradesService.createExecution({
        tradeId: trade.id,
        type: ExecutionType.STOP_LOSS,
        price: exitPrice,
        quantity: quantity,
        pnl: pnl,
        percentOfPosition: 100,
        exchangeOrderId: trade.stopLossOrderId || undefined
      });

      trade.status = 'CLOSED';
      trade.exitPrice = exitPrice as any;
      trade.pnl = totalPnl;
      trade.closeReason = reason;
      trade.closedAt = new Date();
      trade.binancePositionAmt = 0 as any;

      await this.tradesRepository.save(trade);

      this.logger.warn(`└─ Closed: ${this.formatQuantityWithUsdt(quantity, exitPrice)} | P&L: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT`);

    } catch (error) {
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
