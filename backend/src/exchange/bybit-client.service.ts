import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export interface BybitOrderResponse {
  orderId: string;
  orderLinkId: string;
}

export interface BybitPosition {
  symbol: string;
  side: 'Buy' | 'Sell' | 'None';
  size: string;
  avgPrice: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  leverage: string;
  markPrice: string;
  liqPrice: string;
  positionValue: string;
}

export interface BybitOrderInfo {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  price: string;
  qty: string;
  orderStatus: string;
  avgPrice: string;
  cumExecQty: string;
}

export interface BybitTradeHistory {
  symbol: string;
  side: string;
  execPrice: string;
  execQty: string;
  execTime: string;
}

@Injectable()
export class BybitClientService {
  private readonly logger = new Logger(BybitClientService.name);

  private readonly MAINNET_URL = 'https://api.bybit.com';
  private readonly TESTNET_URL = 'https://api-testnet.bybit.com';
  private readonly RECV_WINDOW = '5000';

  private getBaseUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_URL : this.MAINNET_URL;
  }

  private generateSignature(
    timestamp: string,
    apiKey: string,
    apiSecret: string,
    params: string
  ): string {
    const preSign = timestamp + apiKey + this.RECV_WINDOW + params;
    return crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');
  }

  private getHeaders(apiKey: string, apiSecret: string, params: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const signature = this.generateSignature(timestamp, apiKey, apiSecret, params);

    return {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': this.RECV_WINDOW,
      'Content-Type': 'application/json',
    };
  }

  async createOrder(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    params: {
      symbol: string;
      side: 'Buy' | 'Sell';
      orderType: 'Market' | 'Limit';
      qty: string;
      price?: string;
      stopLoss?: string;
      takeProfit?: string;
      positionIdx?: number;
      reduceOnly?: boolean;
    }
  ): Promise<BybitOrderResponse> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/create';

    const body: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      qty: params.qty,
      positionIdx: params.positionIdx ?? 0,
      reduceOnly: params.reduceOnly ?? false,
    };

    if (params.orderType === 'Limit' && params.price) {
      body.price = params.price;
      body.timeInForce = 'GTC';
    }

    if (params.stopLoss) {
      body.stopLoss = params.stopLoss;
      body.slOrderType = 'Market';
    }

    if (params.takeProfit) {
      body.takeProfit = params.takeProfit;
      body.tpOrderType = 'Market';
    }

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      this.logger.log(`[BYBIT] Order created: ${response.data.result.orderId}`);
      return response.data.result;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to create order: ${error.response?.data?.retMsg || error.message}`);
      throw error;
    }
  }

  async setLeverage(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    leverage: number
  ): Promise<void> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/set-leverage';

    const body = {
      category: 'linear',
      symbol,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString(),
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] Leverage set to ${leverage}x for ${symbol}`);
      } else if (response.data.retCode === 110043) {
        this.logger.debug(`[BYBIT] Leverage already set to ${leverage}x for ${symbol}`);
      } else {
        this.logger.warn(`[BYBIT] Set leverage response: ${response.data.retMsg}`);
      }
    } catch (error: any) {
      if (error.response?.data?.retCode === 110043) {
        this.logger.debug(`[BYBIT] Leverage already set for ${symbol}`);
      } else {
        this.logger.warn(`[BYBIT] Failed to set leverage: ${error.response?.data?.retMsg || error.message}`);
      }
    }
  }

  async setMarginMode(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    marginMode: 'ISOLATED' | 'CROSS',
    leverage: number
  ): Promise<void> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/switch-isolated';

    const tradeMode = marginMode === 'ISOLATED' ? 1 : 0;

    const body = {
      category: 'linear',
      symbol,
      tradeMode,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString(),
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] Margin mode set to ${marginMode} for ${symbol}`);
      } else if (response.data.retCode === 110026) {
        this.logger.debug(`[BYBIT] Margin mode already set to ${marginMode} for ${symbol}`);
      } else {
        this.logger.warn(`[BYBIT] Set margin mode response: ${response.data.retMsg}`);
      }
    } catch (error: any) {
      if (error.response?.data?.retCode === 110026) {
        this.logger.debug(`[BYBIT] Margin mode already set for ${symbol}`);
      } else {
        this.logger.warn(`[BYBIT] Failed to set margin mode: ${error.response?.data?.retMsg || error.message}`);
      }
    }
  }

  async getPositions(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol?: string
  ): Promise<BybitPosition[]> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/list';

    const params: Record<string, string> = {
      category: 'linear',
      settleCoin: 'USDT',
    };

    if (symbol) {
      params.symbol = symbol;
    }

    const queryString = new URLSearchParams(params).toString();
    const headers = this.getHeaders(apiKey, apiSecret, queryString);

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      return response.data.result.list || [];
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get positions: ${error.response?.data?.retMsg || error.message}`);
      throw error;
    }
  }

  async getOrderInfo(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    orderId: string
  ): Promise<BybitOrderInfo | null> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/realtime';

    const params = {
      category: 'linear',
      symbol,
      orderId,
    };

    const queryString = new URLSearchParams(params).toString();
    const headers = this.getHeaders(apiKey, apiSecret, queryString);

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        return null;
      }

      const orders = response.data.result.list || [];
      return orders.length > 0 ? orders[0] : null;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get order info: ${error.response?.data?.retMsg || error.message}`);
      return null;
    }
  }

  async getOrderHistory(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    orderId: string
  ): Promise<BybitOrderInfo | null> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/history';

    const params = {
      category: 'linear',
      symbol,
      orderId,
    };

    const queryString = new URLSearchParams(params).toString();
    const headers = this.getHeaders(apiKey, apiSecret, queryString);

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        return null;
      }

      const orders = response.data.result.list || [];
      return orders.length > 0 ? orders[0] : null;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get order history: ${error.response?.data?.retMsg || error.message}`);
      return null;
    }
  }

  async cancelOrder(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    orderId: string
  ): Promise<boolean> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/cancel';

    const body = {
      category: 'linear',
      symbol,
      orderId,
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] Order ${orderId} cancelled`);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.debug(`[BYBIT] Failed to cancel order: ${error.response?.data?.retMsg || error.message}`);
      return false;
    }
  }

  async getWalletBalance(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean
  ): Promise<number> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/account/wallet-balance';

    try {
      const params = {
        accountType: 'UNIFIED',
        coin: 'USDT'
      };

      const queryString = new URLSearchParams(params).toString();
      const headers = this.getHeaders(apiKey, apiSecret, queryString);

      this.logger.debug(`[BYBIT] Fetching wallet balance with accountType=UNIFIED (Unified Trading Account)`);

      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      const accounts = response.data.result.list || [];
      if (accounts.length > 0) {
        const account = accounts[0];

        const totalAvailableBalance = parseFloat(account.totalAvailableBalance || '0');
        const totalEquity = parseFloat(account.totalEquity || '0');
        const totalWalletBalance = parseFloat(account.totalWalletBalance || '0');
        const totalMarginBalance = parseFloat(account.totalMarginBalance || '0');

        this.logger.log(
          `[BYBIT] Unified Trading Account Balance:\n` +
          `  Available for Trading: ${totalAvailableBalance.toFixed(2)} USD (FREE balance)\n` +
          `  Total Equity: ${totalEquity.toFixed(2)} USD (includes unrealized PnL)\n` +
          `  Total Wallet: ${totalWalletBalance.toFixed(2)} USD\n` +
          `  Total Margin: ${totalMarginBalance.toFixed(2)} USD`
        );

        return totalAvailableBalance;
      }

      this.logger.warn(`[BYBIT] No account data returned from wallet balance endpoint`);
      return 0;
    } catch (error: any) {
      const statusCode = error.response?.status;
      const retCode = error.response?.data?.retCode;
      const retMsg = error.response?.data?.retMsg;

      if (statusCode === 403 || retCode === 10003 || retCode === 10005) {
        this.logger.error(
          `[BYBIT] API Key Permission Error (${statusCode || retCode}):\n` +
          `  REQUIRED API KEY PERMISSIONS:\n` +
          `  ✓ Contract Trading (for placing orders)\n` +
          `  ✓ Read-Only OR Account Transfer (for reading wallet balance)\n` +
          `\n` +
          `  TROUBLESHOOTING:\n` +
          `  1. Go to Bybit > API Management > Select your API key > Edit Permissions\n` +
          `  2. Enable "Contract Trading" permission\n` +
          `  3. Enable "Read-Only" permission (recommended) OR "Account Transfer"\n` +
          `  4. Save and wait 1-2 minutes for changes to propagate\n` +
          `  5. Ensure "Unified Trading Account" is ACTIVE on your Bybit account\n` +
          `  6. If IP restriction is enabled, add your server IP to the whitelist\n` +
          `\n` +
          `  Error Details: ${retMsg || error.message}`
        );
        throw new Error('Bybit API Key lacks required permissions. Enable "Read-Only" or "Account Transfer" permission.');
      }

      this.logger.error(`[BYBIT] Failed to get wallet balance: ${retMsg || error.message}`);
      throw new Error(`Failed to get Bybit wallet balance: ${retMsg || error.message}`);
    }
  }

  async getCurrentPrice(
    isTestnet: boolean,
    symbol: string
  ): Promise<number> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/market/tickers';

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?category=linear&symbol=${symbol}`);

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      const tickers = response.data.result.list || [];
      if (tickers.length > 0) {
        return parseFloat(tickers[0].lastPrice);
      }

      return 0;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get current price: ${error.message}`);
      return 0;
    }
  }

  async getLastTradePrice(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string
  ): Promise<number | null> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/execution/list';

    const params = {
      category: 'linear',
      symbol,
      limit: '1',
    };

    const queryString = new URLSearchParams(params).toString();
    const headers = this.getHeaders(apiKey, apiSecret, queryString);

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        return null;
      }

      const executions = response.data.result.list || [];
      if (executions.length > 0) {
        return parseFloat(executions[0].execPrice);
      }

      return null;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get last trade price: ${error.message}`);
      return null;
    }
  }

  async setTradingStop(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    stopLoss?: string,
    takeProfit?: string
  ): Promise<boolean> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/trading-stop';

    const body: Record<string, any> = {
      category: 'linear',
      symbol,
      positionIdx: 0,
    };

    if (stopLoss) {
      body.stopLoss = stopLoss;
      body.slTriggerBy = 'MarkPrice';
    }

    if (takeProfit) {
      body.takeProfit = takeProfit;
      body.tpTriggerBy = 'MarkPrice';
    }

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] Trading stop set for ${symbol}`);
        return true;
      }

      this.logger.warn(`[BYBIT] Set trading stop response: ${response.data.retMsg}`);
      return false;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to set trading stop: ${error.response?.data?.retMsg || error.message}`);
      return false;
    }
  }

  async getOpenOrders(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol?: string
  ): Promise<BybitOrderInfo[]> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/realtime';

    const params: Record<string, string> = {
      category: 'linear',
    };

    if (symbol) {
      params.symbol = symbol;
    }

    const queryString = new URLSearchParams(params).toString();
    const headers = this.getHeaders(apiKey, apiSecret, queryString);

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, { headers });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      return response.data.result.list || [];
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get open orders: ${error.response?.data?.retMsg || error.message}`);
      return [];
    }
  }

  /**
   * Get symbol trading rules (quantity step, price tick, min quantity)
   */
  async getSymbolRules(
    isTestnet: boolean,
    symbol: string
  ): Promise<{ qtyStep: string; priceTick: string; minQty: string }> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/market/instruments-info';

    try {
      const response = await axios.get(
        `${baseUrl}${endpoint}?category=linear&symbol=${symbol}`
      );

      if (response.data.retCode !== 0) {
        this.logger.warn(`[BYBIT] Failed to get symbol rules: ${response.data.retMsg}`);
        return { qtyStep: '0.001', priceTick: '0.01', minQty: '0.001' };
      }

      const instruments = response.data.result.list || [];
      if (instruments.length > 0) {
        const info = instruments[0];
        const lotSizeFilter = info.lotSizeFilter || {};
        const priceFilter = info.priceFilter || {};

        const rules = {
          qtyStep: lotSizeFilter.qtyStep || '0.001',
          minQty: lotSizeFilter.minOrderQty || '0.001',
          priceTick: priceFilter.tickSize || '0.01',
        };

        this.logger.debug(`[BYBIT] Symbol rules for ${symbol}: Step=${rules.qtyStep}, Tick=${rules.priceTick}, MinQty=${rules.minQty}`);
        return rules;
      }

      return { qtyStep: '0.001', priceTick: '0.01', minQty: '0.001' };
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get symbol rules: ${error.message}`);
      return { qtyStep: '0.001', priceTick: '0.01', minQty: '0.001' };
    }
  }

  async cancelAllOrders(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string
  ): Promise<boolean> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/cancel-all';

    const body = {
      category: 'linear',
      symbol,
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, { headers });

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] All orders cancelled for ${symbol}`);
        return true;
      }

      this.logger.warn(`[BYBIT] Cancel all orders response: ${response.data.retMsg}`);
      return false;
    } catch (error: any) {
      this.logger.debug(`[BYBIT] Failed to cancel all orders: ${error.response?.data?.retMsg || error.message}`);
      return false;
    }
  }
}
