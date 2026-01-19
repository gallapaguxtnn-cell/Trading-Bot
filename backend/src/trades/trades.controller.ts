import { Controller, Get, Post, Query, Param, Logger } from '@nestjs/common';
import { TradesService } from './trades.service';
import { PositionSyncService } from '../position-sync/position-sync.service';
import { StrategiesService } from '../strategies/strategies.service';
import { EncryptionUtil } from '../utils/encryption.util';
import { Exchange } from '../strategies/strategy.entity';
import { BybitClientService } from '../exchange/bybit-client.service';
import { Trade } from '../strategies/trade.entity';
import axios from 'axios';
import * as crypto from 'crypto';
import Decimal from 'decimal.js';

interface SymbolRules {
  qtyStep: number;
  minQty: number;
  priceTick: number;
}

@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);
  private readonly BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
  private readonly BINANCE_MAINNET_URL = 'https://fapi.binance.com';

  constructor(
    private readonly tradesService: TradesService,
    private readonly positionSyncService: PositionSyncService,
    private readonly strategiesService: StrategiesService,
    private readonly bybitClient: BybitClientService,
  ) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.tradesService.findAll(status, limit ? parseInt(limit) : undefined);
  }

  @Get('stats')
  getStats() {
    return this.tradesService.getStats();
  }

  @Post('sync')
  async forceSync() {
    const result = await this.positionSyncService.forceSync();
    return {
      success: true,
      message: 'Sync completed',
      ...result,
      lastSyncTime: this.positionSyncService.getLastSyncTime()
    };
  }

  @Get('sync/status')
  getSyncStatus() {
    return {
      lastSyncTime: this.positionSyncService.getLastSyncTime()
    };
  }

  @Post('close-all')
  async closeAllPositions() {
    const openTrades = await this.tradesService.findOpenTrades();
    const results: { closed: number; errors: string[]; alreadyClosed: number } = {
      closed: 0,
      errors: [],
      alreadyClosed: 0
    };

    const strategiesMap = new Map();

    for (const trade of openTrades) {
      try {
        let strategy = strategiesMap.get(trade.strategyId);
        if (!strategy) {
          strategy = await this.strategiesService.findOne(trade.strategyId);
          if (strategy) {
            strategiesMap.set(trade.strategyId, strategy);
          }
        }

        if (!strategy) {
          await this.tradesService.updateTrade(trade.id, {
            status: 'CLOSED',
            closeReason: 'MANUAL',
            closedAt: new Date(),
            error: 'Strategy not found - marked as closed'
          });
          results.errors.push(`Strategy not found for trade ${trade.id} - marked as closed`);
          continue;
        }

        const exchange = strategy.exchange || Exchange.BINANCE;
        const decryptedKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
        const decryptedSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

        const closeResult = await this.closeTradeOnExchange(
          trade,
          strategy,
          exchange,
          decryptedKey,
          decryptedSecret
        );

        if (closeResult.success) {
          results.closed++;
        } else if (closeResult.alreadyClosed) {
          results.alreadyClosed++;
        } else {
          results.errors.push(`Trade ${trade.id}: ${closeResult.error}`);
        }

      } catch (error: any) {
        this.logger.error(`Failed to close trade ${trade.id}: ${error.message}`);
        results.errors.push(`Trade ${trade.id}: ${error.message}`);
      }
    }

    return {
      success: true,
      message: `Closed ${results.closed} positions, ${results.alreadyClosed} already closed`,
      ...results
    };
  }

  @Post('close/:tradeId')
  async closePosition(@Param('tradeId') tradeId: string) {
    const trade = await this.tradesService.findOpenTrades()
      .then(trades => trades.find(t => t.id === tradeId));

    if (!trade) {
      return { success: false, message: 'Trade not found or already closed' };
    }

    const strategy = await this.strategiesService.findOne(trade.strategyId);
    if (!strategy) {
      await this.tradesService.updateTrade(trade.id, {
        status: 'CLOSED',
        closeReason: 'MANUAL',
        closedAt: new Date(),
        error: 'Strategy not found'
      });
      return { success: false, message: 'Strategy not found - trade marked as closed' };
    }

    const exchange = strategy.exchange || Exchange.BINANCE;
    const decryptedKey = (await EncryptionUtil.decrypt(strategy.apiKey)).trim();
    const decryptedSecret = (await EncryptionUtil.decrypt(strategy.apiSecret)).trim();

    const result = await this.closeTradeOnExchange(
      trade,
      strategy,
      exchange,
      decryptedKey,
      decryptedSecret
    );

    if (result.success) {
      return { success: true, message: 'Position closed', pnl: result.pnl };
    } else if (result.alreadyClosed) {
      return { success: true, message: 'Position was already closed on exchange', pnl: result.pnl };
    } else {
      return { success: false, message: result.error };
    }
  }

  private async closeTradeOnExchange(
    trade: Trade,
    strategy: any,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string
  ): Promise<{ success: boolean; alreadyClosed?: boolean; pnl?: number; error?: string }> {

    try {
      this.logger.log(`[CLOSE] Starting to close trade ${trade.id} for ${trade.symbol}`);

      await this.cancelAllOrders(trade.symbol, exchange, apiKey, apiSecret, strategy.isTestnet);

      const positionSize = await this.getPositionSize(
        trade.symbol,
        exchange,
        apiKey,
        apiSecret,
        strategy.isTestnet
      );

      this.logger.log(`[CLOSE] Position size on exchange: ${positionSize}`);

      const exitPrice = await this.getCurrentPrice(trade.symbol, exchange, strategy.isTestnet);
      const entryPrice = parseFloat(trade.entryPrice as any);
      const dbQuantity = parseFloat(trade.quantity as any);

      if (positionSize === 0) {
        this.logger.warn(`[CLOSE] Position already closed on exchange for ${trade.symbol}`);

        let pnl = trade.pnl ? parseFloat(trade.pnl as any) : 0;

        await this.tradesService.updateTrade(trade.id, {
          status: 'CLOSED',
          exitPrice: exitPrice || entryPrice,
          pnl,
          closeReason: 'MANUAL',
          closedAt: new Date()
        });

        return { success: false, alreadyClosed: true, pnl };
      }

      const rules = await this.getSymbolRules(trade.symbol, strategy.isTestnet, exchange);
      const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
      const formattedQty = this.normalizeQuantity(positionSize, rules.qtyStep, rules.minQty);

      this.logger.log(`[CLOSE] Closing ${trade.symbol}: side=${closeSide}, qty=${formattedQty}`);

      if (exchange === Exchange.BYBIT) {
        await this.bybitClient.createOrder(apiKey, apiSecret, strategy.isTestnet, {
          symbol: trade.symbol,
          side: closeSide === 'BUY' ? 'Buy' : 'Sell',
          orderType: 'Market',
          qty: formattedQty,
          reduceOnly: true
        });
      } else {
        await this.closeBinancePosition(
          trade.symbol,
          closeSide,
          formattedQty,
          apiKey,
          apiSecret,
          strategy.isTestnet
        );
      }

      let pnl: number;
      if (trade.side === 'BUY') {
        pnl = (exitPrice - entryPrice) * positionSize;
      } else {
        pnl = (entryPrice - exitPrice) * positionSize;
      }

      await this.tradesService.updateTrade(trade.id, {
        status: 'CLOSED',
        pnl,
        exitPrice,
        closeReason: 'MANUAL',
        closedAt: new Date()
      });

      this.logger.log(`[CLOSE] Trade ${trade.id} closed successfully with P&L: ${pnl.toFixed(4)}`);

      return { success: true, pnl };

    } catch (error: any) {
      this.logger.error(`[CLOSE] Error closing trade ${trade.id}: ${error.message}`);

      if (error.response?.data) {
        this.logger.error(`[CLOSE] Exchange response: ${JSON.stringify(error.response.data)}`);
      }

      return { success: false, error: error.message };
    }
  }

  private async cancelAllOrders(
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    try {
      if (exchange === Exchange.BYBIT) {
        await this.bybitClient.cancelAllOrders(apiKey, apiSecret, isTestnet, symbol);
      } else {
        const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
        const params = new URLSearchParams();
        params.append('symbol', symbol);
        params.append('timestamp', Date.now().toString());

        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

        await axios.delete(`${baseURL}/fapi/v1/allOpenOrders?${queryString}&signature=${signature}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });
      }
      this.logger.log(`[CLOSE] Cancelled all orders for ${symbol}`);
    } catch (error: any) {
      this.logger.warn(`[CLOSE] Failed to cancel orders for ${symbol}: ${error.message}`);
    }
  }

  private async getPositionSize(
    symbol: string,
    exchange: Exchange,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<number> {
    try {
      if (exchange === Exchange.BYBIT) {
        const positions = await this.bybitClient.getPositions(apiKey, apiSecret, isTestnet, symbol);
        const position = positions.find((p: any) => p.symbol === symbol && parseFloat(p.size) > 0);
        return position ? Math.abs(parseFloat(position.size)) : 0;
      } else {
        const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
        const params = new URLSearchParams();
        params.append('symbol', symbol);
        params.append('timestamp', Date.now().toString());

        const queryString = params.toString();
        const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

        const response = await axios.get(
          `${baseURL}/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
          { headers: { 'X-MBX-APIKEY': apiKey } }
        );

        const position = response.data.find((p: any) => p.symbol === symbol);
        return position ? Math.abs(parseFloat(position.positionAmt)) : 0;
      }
    } catch (error: any) {
      this.logger.error(`[CLOSE] Failed to get position size: ${error.message}`);
      return 0;
    }
  }

  private async getSymbolRules(
    symbol: string,
    isTestnet: boolean,
    exchange: Exchange
  ): Promise<SymbolRules> {
    const defaultRules = { qtyStep: 0.001, minQty: 0.001, priceTick: 0.01 };

    try {
      if (exchange === Exchange.BYBIT) {
        return defaultRules;
      }

      const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const response = await axios.get(`${baseURL}/fapi/v1/exchangeInfo`);
      const symbolInfo = response.data.symbols.find((s: any) => s.symbol === symbol);

      if (!symbolInfo) return defaultRules;

      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');

      return {
        qtyStep: lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : defaultRules.qtyStep,
        minQty: lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : defaultRules.minQty,
        priceTick: priceFilter ? parseFloat(priceFilter.tickSize) : defaultRules.priceTick
      };
    } catch (error) {
      return defaultRules;
    }
  }

  private normalizeQuantity(quantity: number, step: number, minQty: number): string {
    const decimal = new Decimal(quantity);
    const stepDecimal = new Decimal(step);
    const normalized = decimal.div(stepDecimal).floor().mul(stepDecimal);
    const result = normalized.lessThan(minQty) ? new Decimal(minQty) : normalized;

    const stepStr = step.toString();
    const decimalPlaces = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;

    return result.toFixed(decimalPlaces);
  }

  private async closeBinancePosition(
    symbol: string,
    side: string,
    quantity: string,
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<void> {
    const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
    const params = new URLSearchParams();
    params.append('symbol', symbol);
    params.append('side', side);
    params.append('type', 'MARKET');
    params.append('quantity', quantity);
    params.append('reduceOnly', 'true');
    params.append('timestamp', Date.now().toString());

    const queryString = params.toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    this.logger.log(`[BINANCE] Closing position: ${symbol} ${side} ${quantity}`);

    const response = await axios.post(
      `${baseURL}/fapi/v1/order`,
      `${queryString}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    this.logger.log(`[BINANCE] Close order response: ${JSON.stringify(response.data)}`);
  }

  private async getCurrentPrice(
    symbol: string,
    exchange: Exchange,
    isTestnet: boolean
  ): Promise<number> {
    try {
      if (exchange === Exchange.BYBIT) {
        return await this.bybitClient.getCurrentPrice(isTestnet, symbol);
      }

      const baseURL = isTestnet ? this.BINANCE_TESTNET_URL : this.BINANCE_MAINNET_URL;
      const response = await axios.get(`${baseURL}/fapi/v1/ticker/price?symbol=${symbol}`);
      return parseFloat(response.data.price);
    } catch (error) {
      this.logger.error(`Failed to get price for ${symbol}`);
      return 0;
    }
  }
}
