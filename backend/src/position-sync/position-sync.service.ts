import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from '../strategies/trade.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService, BybitPosition } from '../exchange/bybit-client.service';
import { TradesService } from '../trades/trades.service';
import { EncryptionUtil } from '../utils/encryption.util';
import axios from 'axios';
import * as crypto from 'crypto';

interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
}

interface NormalizedPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
  markPrice: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
}

function safeParseFloat(value: any, defaultValue: number = 0): number {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseFloat(value);

  if (!isFinite(parsed) || isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

@Injectable()
export class PositionSyncService {
  private readonly logger = new Logger(PositionSyncService.name);
  private readonly BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
  private readonly BINANCE_MAINNET_URL = 'https://fapi.binance.com';
  private lastSyncTime: Date | null = null;
  private syncInProgress = false;

  /**
   * Format price with appropriate decimal places based on the price magnitude
   * This is a fallback when symbol rules aren't available
   */
  private formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toFixed(2);
    } else if (price >= 1) {
      return price.toFixed(4);
    } else if (price >= 0.01) {
      return price.toFixed(6);
    } else {
      return price.toFixed(8);
    }
  }

  constructor(
    @InjectRepository(Trade)
    private readonly tradesRepository: Repository<Trade>,
    @InjectRepository(Strategy)
    private readonly strategiesRepository: Repository<Strategy>,
    private readonly strategiesService: StrategiesService,
    private readonly exchangeService: ExchangeService,
    private readonly bybitClient: BybitClientService,
    private readonly tradesService: TradesService,
  ) {}

  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async syncPositions(): Promise<void> {
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      const activeStrategies = await this.strategiesRepository.find({
        where: { isActive: true },
        select: ['id', 'name', 'asset', 'exchange', 'isTestnet', 'isRealAccount', 'apiKey', 'apiSecret']
      });

      for (const strategy of activeStrategies) {
        try {
          await this.syncStrategyPositions(strategy);
        } catch (error) {
          this.logger.error(`Failed to sync strategy ${strategy.name}: ${error.message}`);
        }
      }

      this.lastSyncTime = new Date();
    } finally {
      this.syncInProgress = false;
    }
  }

  async forceSync(): Promise<{ synced: number; closed: number; imported: number; consolidated: number }> {
    let synced = 0;
    let closed = 0;
    let imported = 0;
    let consolidated = 0;

    const activeStrategies = await this.strategiesRepository.find({
      where: { isActive: true },
      select: ['id', 'name', 'asset', 'exchange', 'isTestnet', 'isRealAccount', 'apiKey', 'apiSecret']
    });

    for (const strategy of activeStrategies) {
      try {
        const result = await this.syncStrategyPositions(strategy);
        synced += result.synced;
        closed += result.closed;
        imported += result.imported;
        consolidated += result.consolidated;
      } catch (error) {
        this.logger.error(`Failed to sync strategy ${strategy.name}: ${error.message}`);
      }
    }

    this.lastSyncTime = new Date();
    return { synced, closed, imported, consolidated };
  }

  private async syncStrategyPositions(strategy: Strategy): Promise<{ synced: number; closed: number; imported: number; consolidated: number }> {
    if (!strategy.apiKey || !strategy.apiSecret) {
      return { synced: 0, closed: 0, imported: 0, consolidated: 0 };
    }

    const exchange = strategy.exchange || Exchange.BINANCE;
    const { apiKey, apiSecret } = await this.decryptCredentials(strategy);

    let positions: NormalizedPosition[];

    if (exchange === Exchange.BYBIT) {
      positions = await this.fetchBybitPositions(apiKey, apiSecret, strategy.isTestnet);
    } else {
      positions = await this.fetchBinancePositions(apiKey, apiSecret, strategy.isTestnet);
    }

    const openPositions = positions.filter(p => p.size !== 0);

    let synced = 0;
    let closed = 0;
    let imported = 0;
    let consolidated = 0;

    for (const position of openPositions) {
      const existingTrades = await this.tradesRepository.find({
        where: {
          strategyId: strategy.id,
          symbol: position.symbol,
          side: position.side,
          status: 'OPEN'
        },
        order: { timestamp: 'ASC' }
      });

      if (existingTrades.length === 0) {
        if (exchange === Exchange.BYBIT) {
          const rules = await this.bybitClient.getSymbolRules(strategy.isTestnet, position.symbol);
          const minQty = parseFloat(rules.minQty);

          if (position.size < minQty) {
            this.logger.warn(
              `[SYNC] Orphan position detected but quantity ${position.size} < minQty ${minQty}. ` +
              `This is dust from closed position. Ignoring.`
            );
            continue;
          }
        }

        this.logger.warn(`[SYNC] Orphan position detected: ${position.symbol} (${position.side}) - importing...`);
        await this.importOrphanPosition(strategy, position);
        imported++;
      } else if (existingTrades.length === 1) {
        if (strategy.breakAgain || strategy.moveSLToBreakeven) {
             await this.checkBreakAgain(existingTrades[0], position, strategy, apiKey, apiSecret);
        }

        await this.updateTradeFromPosition(existingTrades[0], position);
        synced++;
      } else {
        if (strategy.breakAgain || strategy.moveSLToBreakeven) {
          await this.checkBreakAgain(existingTrades[0], position, strategy, apiKey, apiSecret);
        }

        await this.consolidateTrades(existingTrades, position, exchange, apiKey, apiSecret, strategy.isTestnet);
        consolidated += existingTrades.length - 1;
        synced++;
        this.logger.log(`[SYNC] Consolidated ${existingTrades.length} trades into 1 for ${position.symbol}`);
      }
    }

    for (const position of openPositions) {
      const duplicateCheck = await this.tradesRepository.find({
        where: {
          strategyId: strategy.id,
          symbol: position.symbol,
          side: position.side,
          status: 'OPEN'
        },
        order: { timestamp: 'ASC' }
      });

      if (duplicateCheck.length > 1) {
        this.logger.warn(`[SYNC] Found ${duplicateCheck.length} duplicate trades for ${position.symbol} (${position.side}), consolidating...`);
        await this.consolidateTrades(duplicateCheck, position, exchange, apiKey, apiSecret, strategy.isTestnet);
        consolidated += duplicateCheck.length - 1;
        this.logger.log(`[SYNC] Consolidated ${duplicateCheck.length} trades into 1 for ${position.symbol}`);
      }
    }

    const allLocalOpenTrades = await this.tradesRepository.find({
      where: { strategyId: strategy.id, status: 'OPEN' }
    });

    const MIN_TRADE_AGE_SECONDS = 30;
    const now = Date.now();

    for (const trade of allLocalOpenTrades) {
      const matchingPosition = openPositions.find(p =>
        p.symbol === trade.symbol && p.side === trade.side
      );

      if (!matchingPosition) {
        // Race condition protection: Don't close trades that were created recently
        const tradeAgeMs = now - new Date(trade.timestamp).getTime();
        const tradeAgeSeconds = tradeAgeMs / 1000;

        if (tradeAgeSeconds < MIN_TRADE_AGE_SECONDS) {
          continue;
        }

        if (trade.type === 'LIMIT' && trade.exchangeOrderId) {
          const orderStatus = await this.checkOrderStatus(
            trade.exchangeOrderId,
            trade.symbol,
            exchange,
            apiKey,
            apiSecret,
            strategy.isTestnet
          );

          // Don't close if order is still pending (Binance: NEW/PARTIALLY_FILLED, Bybit: New/PartiallyFilled)
          if (orderStatus === 'NEW' || orderStatus === 'New' ||
              orderStatus === 'PARTIALLY_FILLED' || orderStatus === 'PartiallyFilled') {
            this.logger.debug(`[SYNC] Trade ${trade.id} has pending LIMIT order (${orderStatus}), keeping open`);
            continue;
          }

          if (orderStatus === 'FILLED' || orderStatus === 'Filled') {
            this.logger.log(`[SYNC] Trade ${trade.id} order FILLED but no position - position was closed externally`);
          }
        }

        await this.closeTradeAsManual(trade, exchange, apiKey, apiSecret, strategy.isTestnet);
        closed++;
        this.logger.log(`[SYNC] Closed trade ${trade.id} for ${trade.symbol} - no longer exists on exchange`);
      }
    }

    return { synced, closed, imported, consolidated };
  }

  private async fetchBinancePositions(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<NormalizedPosition[]> {
    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    try {
      const response = await axios.get(
        `${baseUrl}/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey }
        }
      );

      return (response.data as BinancePosition[]).map(pos => {
        const posAmt = safeParseFloat(pos.positionAmt);
        return {
          symbol: pos.symbol,
          side: posAmt > 0 ? 'BUY' : 'SELL' as 'BUY' | 'SELL',
          size: Math.abs(posAmt),
          entryPrice: safeParseFloat(pos.entryPrice),
          unrealizedPnl: safeParseFloat(pos.unRealizedProfit),
          leverage: safeParseFloat(pos.leverage, 1),
          markPrice: safeParseFloat(pos.markPrice),
          positionSide: pos.positionSide,
        };
      });
    } catch (error: any) {
      const statusCode = error.response?.status;
      if (statusCode === 401) {
        this.logger.error(
          `[BINANCE AUTH ERROR] API Key is invalid or expired. ` +
          `Please update your Binance API credentials. Status: 401 Unauthorized`
        );
        throw new Error('Binance API Key invalid or expired. Please update credentials.');
      } else if (statusCode === 403) {
        this.logger.error(
          `[BINANCE AUTH ERROR] API Key lacks required permissions or IP is not whitelisted. ` +
          `Please check your Binance API settings. Status: 403 Forbidden`
        );
        throw new Error('Binance API Key lacks permissions. Check API settings and IP whitelist.');
      }
      this.logger.error(`Failed to fetch Binance positions: ${error.message}`);
      throw error;
    }
  }

  private async fetchBybitPositions(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<NormalizedPosition[]> {
    try {
      const positions = await this.bybitClient.getPositions(apiKey, apiSecret, isTestnet);

      return positions
        .filter(pos => pos.side !== 'None' && safeParseFloat(pos.size) !== 0)
        .map(pos => ({
          symbol: pos.symbol,
          side: pos.side === 'Buy' ? 'BUY' : 'SELL' as 'BUY' | 'SELL',
          size: safeParseFloat(pos.size),
          entryPrice: safeParseFloat(pos.avgPrice),
          unrealizedPnl: safeParseFloat(pos.unrealisedPnl),
          leverage: safeParseFloat(pos.leverage, 1),
          markPrice: parseFloat(pos.markPrice),
          positionSide: 'BOTH' as const, // Bybit uses one-way mode (positionIdx: 0)
        }));
    } catch (error: any) {
      const statusCode = error.response?.status;
      if (statusCode === 401) {
        this.logger.error(
          `[BYBIT AUTH ERROR] API Key is invalid or expired. ` +
          `Please update your Bybit API credentials. Status: 401 Unauthorized`
        );
        throw new Error('Bybit API Key invalid or expired. Please update credentials.');
      } else if (statusCode === 403) {
        this.logger.error(
          `[BYBIT AUTH ERROR] API Key lacks required permissions or IP is not whitelisted. ` +
          `Please check your Bybit API settings (Contract Trading permission required). Status: 403 Forbidden`
        );
        throw new Error('Bybit API Key lacks permissions. Check API settings and IP whitelist.');
      }
      this.logger.error(`Failed to fetch Bybit positions: ${error.message}`);
      throw error;
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
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

      const response = await axios.get(
        `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      return response.data.status;
    } catch (error) {
      this.logger.error(`Failed to check order status for ${orderId}: ${error.message}`);
      return null;
    }
  }

  private async consolidateTrades(
    trades: Trade[],
    position: NormalizedPosition,
    exchange: Exchange,
    apiKey?: string,
    apiSecret?: string,
    isTestnet?: boolean
  ): Promise<Trade> {
    trades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const primaryTrade = trades[0];
    const duplicateTrades = trades.slice(1);

    primaryTrade.quantity = position.size as any;
    primaryTrade.entryPrice = position.entryPrice as any;
    primaryTrade.pnl = position.unrealizedPnl as any;
    primaryTrade.binancePositionAmt = position.size as any;

    await this.tradesRepository.save(primaryTrade);

    for (const trade of duplicateTrades) {
      if (apiKey && apiSecret && isTestnet !== undefined) {
        await this.cancelOpenOrders(trade, exchange, apiKey, apiSecret, isTestnet);
      }

      // Mark as closed - these weren't actually closed separately
      // The P&L is tracked on the primary trade, not the duplicates
      trade.status = 'CLOSED';
      trade.closeReason = 'MANUAL'; // Use MANUAL as it's the closest available reason
      trade.closedAt = new Date();
      trade.binancePositionAmt = 0 as any;
      // Don't set fake exitPrice/pnl - leave them as-is or null to indicate consolidation
      // This preserves data integrity and prevents misleading P&L calculations
      trade.exitPrice = null as any;
      trade.pnl = null as any;
      trade.stopLossOrderId = null;
      trade.takeProfitOrderId = null;
      trade.error = 'Duplicate trade consolidated into primary trade';
      await this.tradesRepository.save(trade);

      this.logger.debug(`[CONSOLIDATE] Consolidated duplicate trade ${trade.id} into ${primaryTrade.id} for ${trade.symbol}`);
    }

    this.logger.log(
      `[CONSOLIDATE] ${primaryTrade.symbol} | Qty: ${position.size} | Entry: ${position.entryPrice} | P&L: ${position.unrealizedPnl.toFixed(4)}`
    );

    return primaryTrade;
  }

  private async getLastTradePrice(
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<number | null> {
    if (exchange === Exchange.BYBIT) {
      return await this.bybitClient.getLastTradePrice(apiKey, apiSecret, isTestnet, symbol);
    }

    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&limit=1&timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    try {
      const response = await axios.get(
        `${baseUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey }
        }
      );

      if (response.data && response.data.length > 0) {
        return parseFloat(response.data[0].price);
      }
      return null;
    } catch (error) {
      this.logger.error(`Failed to get last trade price: ${error.message}`);
      return null;
    }
  }

  private async closeTradeAsManual(
    trade: Trade,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    await this.cancelOpenOrders(trade, exchange, apiKey, apiSecret, isTestnet);

    const exitPrice = await this.getLastTradePrice(trade.symbol, exchange, apiKey, apiSecret, isTestnet);
    const currentPrice = exitPrice || await this.getCurrentPrice(trade.symbol, exchange, isTestnet);

    const entryPrice = parseFloat(trade.entryPrice as any);
    const quantity = parseFloat(trade.quantity as any);

    let pnl: number;
    if (trade.side === 'BUY') {
      pnl = (currentPrice - entryPrice) * quantity;
    } else {
      pnl = (entryPrice - currentPrice) * quantity;
    }

    trade.status = 'CLOSED';
    trade.exitPrice = currentPrice as any;
    trade.pnl = pnl as any;
    trade.closeReason = 'MANUAL';
    trade.closedAt = new Date();
    trade.binancePositionAmt = 0 as any;
    trade.stopLossOrderId = null;
    trade.takeProfitOrderId = null;

    await this.tradesRepository.save(trade);
  }

  private async cancelOpenOrders(
    trade: Trade,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    if (exchange === Exchange.BYBIT) {
      if (trade.stopLossOrderId) {
        if (trade.stopLossOrderId.startsWith('BYBIT_TRADING_STOP')) {
          try {
            const bybitSide = trade.side === 'BUY' ? 'Buy' : 'Sell';
            const strategy = await this.strategiesRepository.findOne({ where: { id: trade.strategyId } });
            await this.bybitClient.clearTradingStop(
              apiKey,
              apiSecret,
              isTestnet,
              trade.symbol,
              bybitSide,
              strategy?.hedgeMode
            );
            this.logger.log(`[CANCEL] Cleared Bybit trading stop for ${trade.symbol}`);
          } catch (error: any) {
            this.logger.warn(`[CANCEL] Failed to clear Bybit trading stop: ${error.message}`);
          }
        } else {
          try {
            await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, trade.stopLossOrderId);
            this.logger.log(`[CANCEL] Cancelled Bybit SL order ${trade.stopLossOrderId}`);
          } catch (error: any) {
            if (error.response?.data?.retCode !== 110001) {
              this.logger.warn(`[CANCEL] Failed to cancel Bybit SL: ${error.message}`);
            }
          }
        }
      }

      if (trade.takeProfitOrderId) {
        if (trade.takeProfitOrderId.includes('|')) {
          const tpEntries = trade.takeProfitOrderId.split('|');
          for (const entry of tpEntries) {
            const orderId = entry.includes(':') ? entry.split(':')[1] : entry;
            if (!orderId || orderId === 'null' || orderId === 'undefined') continue;

            try {
              await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, orderId);
              this.logger.log(`[CANCEL] Cancelled Bybit TP order ${orderId}`);
            } catch (error: any) {
              if (error.response?.data?.retCode !== 110001) {
                this.logger.warn(`[CANCEL] Failed to cancel Bybit TP ${orderId}: ${error.message}`);
              }
            }
          }
        } else if (!trade.takeProfitOrderId.startsWith('BYBIT_TRADING_STOP')) {
          try {
            await this.bybitClient.cancelOrder(apiKey, apiSecret, isTestnet, trade.symbol, trade.takeProfitOrderId);
            this.logger.log(`[CANCEL] Cancelled Bybit TP order ${trade.takeProfitOrderId}`);
          } catch (error: any) {
            if (error.response?.data?.retCode !== 110001) {
              this.logger.warn(`[CANCEL] Failed to cancel Bybit TP: ${error.message}`);
            }
          }
        }
      }
      return;
    }

    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;

    if (trade.stopLossOrderId) {
      try {
        await this.cancelBinanceOrderOrAlgo(trade.stopLossOrderId, trade.symbol, apiKey, apiSecret, isTestnet);
        this.logger.log(`[CANCEL] Cancelled SL order ${trade.stopLossOrderId} for ${trade.symbol}`);
      } catch (error: any) {
        if (error.response?.data?.code !== -2011) {
          this.logger.debug(`[CANCEL] Could not cancel SL order: ${error.response?.data?.msg || error.message}`);
        }
      }
    }

    if (trade.takeProfitOrderId) {
      try {
        const timestamp = Date.now();
        const queryString = `symbol=${trade.symbol}&orderId=${trade.takeProfitOrderId}&timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

        await axios.delete(
          `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
          { headers: { 'X-MBX-APIKEY': apiKey } }
        );
        this.logger.log(`[CANCEL] Cancelled TP order ${trade.takeProfitOrderId} for ${trade.symbol}`);
      } catch (error: any) {
        if (error.response?.data?.code !== -2011) {
          this.logger.debug(`[CANCEL] Could not cancel TP order: ${error.response?.data?.msg || error.message}`);
        }
      }
    }
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

    await axios.delete(`${baseUrl}/fapi/v1/algoOrder?${queryString}&signature=${signature}`, {
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
    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;

    try {
      // Try as Algo Order first (STOP_MARKET conditional orders created after Dec 2025)
      await this.cancelBinanceAlgoOrder(orderId, apiKey, apiSecret, isTestnet);
      this.logger.debug(`[CANCEL] Successfully cancelled Algo Order ${orderId}`);
    } catch (algoError: any) {
      const algoErrorCode = algoError.response?.data?.code;

      // If not found as Algo Order, try as regular order (backwards compatibility)
      if (algoErrorCode === -4143 || algoErrorCode === -1102) {
        try {
          const timestamp = Date.now();
          const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
          const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

          await axios.delete(
            `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
            { headers: { 'X-MBX-APIKEY': apiKey } }
          );
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

  private async updateTradeFromPosition(trade: Trade, position: NormalizedPosition): Promise<void> {
    if (trade.side !== position.side) {
      this.logger.error(
        `[SYNC INCONSISTENCY] Trade ${trade.id} is ${trade.side} but exchange position is ${position.side} for ${trade.symbol}. ` +
        `This may indicate a sync issue. Correcting trade side to match exchange.`
      );
      trade.side = position.side;
    }

    if (!(trade.lastTpLevel || 0)) {
      trade.pnl = position.unrealizedPnl as any;
    }
    trade.binancePositionAmt = position.size as any;
    trade.quantity = position.size as any;
    trade.entryPrice = position.entryPrice as any;

    await this.tradesRepository.save(trade);
  }

  private async getCurrentPrice(symbol: string, exchange: Exchange, isTestnet: boolean): Promise<number> {
    if (exchange === Exchange.BYBIT) {
      return await this.bybitClient.getCurrentPrice(isTestnet, symbol);
    }

    const baseUrl = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;

    try {
      const response = await axios.get(`${baseUrl}/fapi/v1/ticker/price?symbol=${symbol}`);
      return parseFloat(response.data.price);
    } catch (error) {
      this.logger.error(`Failed to get current price for ${symbol}: ${error.message}`);
      return 0;
    }
  }

  private async decryptCredentials(strategy: Strategy) {
    const [apiKey, apiSecret] = await Promise.all([
      EncryptionUtil.decrypt(strategy.apiKey),
      EncryptionUtil.decrypt(strategy.apiSecret)
    ]);

    return {
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim()
    };
  }

  private async importOrphanPosition(strategy: Strategy, position: NormalizedPosition): Promise<Trade> {
    const trade = this.tradesRepository.create({
      strategyId: strategy.id,
      symbol: position.symbol,
      side: position.side,
      type: 'MARKET',
      entryPrice: position.entryPrice as any,
      quantity: position.size as any,
      pnl: position.unrealizedPnl as any,
      status: 'OPEN',
      binancePositionAmt: position.size as any,
    });

    const savedTrade = await this.tradesRepository.save(trade);
    this.logger.log(`[SYNC] Imported orphan position as trade ${savedTrade.id}: ${position.symbol} ${position.side} @ ${position.entryPrice}`);
    return savedTrade;
  }

  public async checkBreakAgain(
    trade: Trade,
    position: NormalizedPosition | undefined,
    strategy: Strategy,
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    try {
        const entryPrice = safeParseFloat(trade.entryPrice as any);
        const currentStopLoss = safeParseFloat(trade.currentStopLoss as any);
        const side = trade.side;
        const lastTpLevel = trade.lastTpLevel || 0;

        if (!entryPrice || !currentStopLoss) {
          this.logger.debug(`[BREAK] Skipping: entryPrice=${entryPrice}, currentStopLoss=${currentStopLoss}`);
          return;
        }

        let newStopLoss: number | null = null;
        let triggeredLevel = '';

        const tp1Percent = strategy.takeProfitPercentage1 || 0;
        const tp2Percent = strategy.takeProfitPercentage2 || 0;
        const tp3Percent = strategy.takeProfitPercentage3 || 0;

        const getPriceAtPercent = (percent: number) => {
            if (side === 'BUY') return entryPrice * (1 + percent / 100);
            return entryPrice * (1 - percent / 100);
        };

        const tp1Price = tp1Percent ? getPriceAtPercent(tp1Percent) : null;
        const tp2Price = tp2Percent ? getPriceAtPercent(tp2Percent) : null;
        const tp3Price = tp3Percent ? getPriceAtPercent(tp3Percent) : null;

        if (side === 'BUY') {
            if (lastTpLevel >= 3 && tp3Price && tp2Price && strategy.breakAgain) {
                if (currentStopLoss < tp2Price) {
                    newStopLoss = tp2Price;
                    triggeredLevel = 'TP3 filled -> SL to TP2';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp2Price.toFixed(4)}`);
                }
            }
            else if (lastTpLevel >= 2 && tp2Price && tp1Price) {
                if (strategy.moveSLToBreakeven && currentStopLoss < entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP2 filled -> SL to Breakeven';
                    this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                } else if (strategy.breakAgain && currentStopLoss < tp1Price) {
                    newStopLoss = tp1Price;
                    triggeredLevel = 'TP2 filled -> SL to TP1';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp1Price.toFixed(4)}`);
                }
            }
            else if (lastTpLevel >= 1 && tp1Price) {
                if (strategy.moveSLToBreakeven && currentStopLoss < entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP1 filled -> SL to Breakeven';
                    this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                } else if (strategy.breakAgain && currentStopLoss < entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP1 filled -> SL to Entry';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                }
            }
        } else {
            if (lastTpLevel >= 3 && tp3Price && tp2Price && strategy.breakAgain) {
                if (currentStopLoss > tp2Price) {
                    newStopLoss = tp2Price;
                    triggeredLevel = 'TP3 filled -> SL to TP2';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp2Price.toFixed(4)}`);
                }
            }
            else if (lastTpLevel >= 2 && tp2Price && tp1Price) {
                if (strategy.moveSLToBreakeven && currentStopLoss > entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP2 filled -> SL to Breakeven';
                    this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                } else if (strategy.breakAgain && currentStopLoss > tp1Price) {
                    newStopLoss = tp1Price;
                    triggeredLevel = 'TP2 filled -> SL to TP1';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${tp1Price.toFixed(4)}`);
                }
            }
            else if (lastTpLevel >= 1 && tp1Price) {
                if (strategy.moveSLToBreakeven && currentStopLoss > entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP1 filled -> SL to Breakeven';
                    this.logger.log(`[BREAK EVEN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                } else if (strategy.breakAgain && currentStopLoss > entryPrice) {
                    newStopLoss = entryPrice;
                    triggeredLevel = 'TP1 filled -> SL to Entry';
                    this.logger.log(`[BREAK AGAIN] ${triggeredLevel}: Last TP level=${lastTpLevel}, moving SL from ${currentStopLoss.toFixed(4)} to ${entryPrice.toFixed(4)}`);
                }
            }
        }

        if (newStopLoss) {
            const currentSlFormatted = currentStopLoss ? currentStopLoss.toFixed(4) : 'N/A';
            this.logger.log(
              `[BREAK] ${triggeredLevel} | ` +
              `Trade ID: ${trade.id.substring(0, 8)} | Symbol: ${trade.symbol} | ` +
              `Qty: ${safeParseFloat(trade.quantity as any).toFixed(2)} | ` +
              `Old SL: ${currentSlFormatted} → New SL: ${newStopLoss.toFixed(4)} | ` +
              `Note: Other trades in same position keep their own independent SL`
            );

            const formattedStopLoss = this.formatPrice(newStopLoss);

            if (strategy.exchange === Exchange.BYBIT && !trade.isFromAveraging) {
                 await this.bybitClient.setTradingStop(
                     apiKey,
                     apiSecret,
                     strategy.isTestnet,
                     trade.symbol,
                     side === 'BUY' ? 'Buy' : 'Sell',
                     formattedStopLoss,
                     undefined,
                     strategy.hedgeMode
                 );
                 this.logger.log(
                   `[BYBIT] Updated position-level SL via setTradingStop to ${formattedStopLoss} (first entry only)`
                 );
            } else if (strategy.exchange === Exchange.BYBIT && trade.isFromAveraging) {
                 this.logger.log(
                   `[BYBIT] Averaging trade: Updated currentStopLoss to ${formattedStopLoss} in DB (software monitoring). ` +
                   `Note: Cannot use setTradingStop for averaging trades (only 1 position-level SL allowed).`
                 );
            } else {
                     try {
                        const baseUrl = strategy.isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;

                        if (trade.stopLossOrderId) {
                             await this.cancelBinanceOrderOrAlgo(trade.stopLossOrderId, trade.symbol, apiKey, apiSecret, strategy.isTestnet);
                        }

                        const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
                        const tradeQuantity = Math.abs(safeParseFloat(trade.quantity as any));
                        const params = new URLSearchParams();
                        params.append('symbol', trade.symbol);
                        params.append('side', closeSide);
                        params.append('algoType', 'CONDITIONAL');
                        params.append('type', 'STOP_MARKET');
                        params.append('quantity', tradeQuantity.toFixed(2));
                        params.append('triggerPrice', formattedStopLoss);
                        params.append('workingType', 'MARK_PRICE');

                        if (strategy.hedgeMode) {
                            const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
                            params.append('positionSide', positionSide);
                        }

                        params.append('timestamp', Date.now().toString());

                        const q2 = params.toString();
                        const s2 = crypto.createHmac('sha256', apiSecret).update(q2).digest('hex');
                         const res = await axios.post(`${baseUrl}/fapi/v1/algoOrder`, `${q2}&signature=${s2}`, {
                            headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }
                        });

                        trade.stopLossOrderId = res.data.algoId.toString();
                     } catch(err) {
                         this.logger.error(`[BREAK AGAIN] Failed to update SL on Binance: ${err.message}`);
                     }
            }
            
            trade.currentStopLoss = newStopLoss as any;
            await this.tradesRepository.save(trade);
        }

    } catch (err) {
        this.logger.error(`[BREAK AGAIN] Error in check logic: ${err.message}`);
    }
  }
}
