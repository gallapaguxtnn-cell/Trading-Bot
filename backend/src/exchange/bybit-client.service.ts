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

  // Proxy configuration (set via environment variables)
  private readonly HTTP_PROXY = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

  private getBaseUrl(isTestnet: boolean): string {
    return isTestnet ? this.TESTNET_URL : this.MAINNET_URL;
  }

  private getAxiosConfig(): any {
    const config: any = {};

    // Add proxy configuration if available
    if (this.HTTP_PROXY) {
      try {
        const proxyUrl = new URL(this.HTTP_PROXY);
        config.proxy = {
          host: proxyUrl.hostname,
          port: parseInt(proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80')),
          protocol: proxyUrl.protocol.replace(':', ''),
        };

        if (proxyUrl.username) {
          config.proxy.auth = {
            username: decodeURIComponent(proxyUrl.username),
            password: decodeURIComponent(proxyUrl.password || ''),
          };
        }

        this.logger.log(`[BYBIT] Using proxy: ${config.proxy.protocol}://${proxyUrl.hostname}:${config.proxy.port}`);
      } catch (error: any) {
        this.logger.error(`[BYBIT] Invalid proxy URL: ${this.HTTP_PROXY} - ${error.message}`);
      }
    }

    return config;
  }

  private isGeoBlockingError(error: any): boolean {
    const errorData = error.response?.data;
    if (typeof errorData === 'string') {
      return errorData.includes('CloudFront') &&
             errorData.includes('configured to block access from your country');
    }
    return false;
  }

  private generateSignature(
    timestamp: string,
    apiKey: string,
    apiSecret: string,
    params: string
  ): string {
    const preSign = timestamp + apiKey + this.RECV_WINDOW + params;
    const signature = crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex');
    return signature;
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
      hedgeMode?: boolean;
    }
  ): Promise<BybitOrderResponse> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/create';

    let positionIdx = params.positionIdx;
    if (positionIdx === undefined) {
      positionIdx = await this.getPositionIdx(apiKey, apiSecret, isTestnet, params.symbol, params.side, params.hedgeMode);
    }

    const body: Record<string, any> = {
      category: 'linear',
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      qty: params.qty,
      positionIdx,
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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      return response.data.result.list || [];
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to get positions: ${error.response?.data?.retMsg || error.message}`);
      throw error;
    }
  }

  async detectPositionMode(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string
  ): Promise<'HEDGE' | 'ONE_WAY' | null> {
    try {
      const positions = await this.getPositions(apiKey, apiSecret, isTestnet, symbol);

      if (positions && positions.length > 0) {
        const hasHedgeMode = positions.some((pos: any) =>
          pos.positionIdx === 1 || pos.positionIdx === 2
        );

        if (hasHedgeMode) {
          this.logger.debug(`[BYBIT] Detected HEDGE mode for ${symbol}`);
          return 'HEDGE';
        }

        const hasOneWayMode = positions.some((pos: any) => pos.positionIdx === 0);
        if (hasOneWayMode) {
          this.logger.debug(`[BYBIT] Detected ONE_WAY mode for ${symbol}`);
          return 'ONE_WAY';
        }
      }

      this.logger.debug(`[BYBIT] Cannot determine position mode for ${symbol} (no positions)`);
      return null;
    } catch (error: any) {
      this.logger.warn(`[BYBIT] Failed to detect position mode: ${error.message}`);
      return null;
    }
  }

  async getPositionIdx(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    hedgeMode?: boolean
  ): Promise<number> {
    if (hedgeMode !== undefined) {
      return hedgeMode ? (side === 'Buy' ? 1 : 2) : 0;
    }

    const mode = await this.detectPositionMode(apiKey, apiSecret, isTestnet, symbol);

    if (mode === 'HEDGE') {
      return side === 'Buy' ? 1 : 2;
    }

    return 0;
  }

  async waitForPosition(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    maxRetries: number = 10,
    delayMs: number = 500,
    hedgeMode?: boolean
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const positions = await this.getPositions(apiKey, apiSecret, isTestnet, symbol);

        const targetPositionIdx = await this.getPositionIdx(apiKey, apiSecret, isTestnet, symbol, side, hedgeMode);

        const hasPosition = positions.some((pos: any) => {
          const hasSize = parseFloat(pos.size || '0') > 0;
          const matchesIdx = pos.positionIdx === targetPositionIdx;
          return hasSize && matchesIdx;
        });

        if (hasPosition) {
          this.logger.log(`[BYBIT] Position confirmed for ${symbol} ${side} after ${attempt} attempt(s)`);
          return true;
        }

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error: any) {
        this.logger.warn(`[BYBIT] Attempt ${attempt} to check position failed: ${error.message}`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.warn(`[BYBIT] Position not confirmed for ${symbol} ${side} after ${maxRetries} attempts`);
    return false;
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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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
      // First check server time sync
      await this.getServerTime(isTestnet);

      // Try UNIFIED first (modern Unified Trading Account)
      this.logger.log(`[BYBIT] Attempting to fetch wallet balance with accountType=UNIFIED...`);

      let params = {
        accountType: 'UNIFIED'
      };

      let queryString = new URLSearchParams(params).toString();
      let headers = this.getHeaders(apiKey, apiSecret, queryString);
      const axiosConfig = { ...this.getAxiosConfig(), headers };

      let response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

      // If UNIFIED fails with specific error, try CONTRACT
      if (response.data.retCode !== 0) {
        this.logger.warn(`[BYBIT] UNIFIED account type failed (retCode: ${response.data.retCode}): ${response.data.retMsg}`);
        this.logger.log(`[BYBIT] Retrying with accountType=CONTRACT (legacy account)...`);

        params = { accountType: 'CONTRACT' };
        queryString = new URLSearchParams(params).toString();
        headers = this.getHeaders(apiKey, apiSecret, queryString);
        const contractAxiosConfig = { ...this.getAxiosConfig(), headers };

        response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, contractAxiosConfig);

        if (response.data.retCode !== 0) {
          throw new Error(`Bybit API Error: ${response.data.retMsg}`);
        }
      }

      const accounts = response.data.result.list || [];
      if (accounts.length > 0) {
        const account = accounts[0];
        const accountType = params.accountType;

        // For UNIFIED accounts, we need to find USDT coin data
        let availableBalance = 0;

        if (accountType === 'UNIFIED' && account.coin) {
          const usdtCoin = account.coin.find((c: any) => c.coin === 'USDT');
          if (usdtCoin) {
            const walletBalance = parseFloat(usdtCoin.walletBalance || '0') || 0;
            const equity = parseFloat(usdtCoin.equity || '0') || 0;
            const totalPositionIM = parseFloat(usdtCoin.totalPositionIM || '0') || 0;
            const totalOrderIM = parseFloat(usdtCoin.totalOrderIM || '0') || 0;
            const availableToWithdraw = parseFloat(usdtCoin.availableToWithdraw || '0') || 0;

            availableBalance = equity - totalPositionIM - totalOrderIM;

            if (availableBalance < 0) {
              availableBalance = 0;
            }

            this.logger.log(
              `[BYBIT] ${accountType} Account - USDT Balance:\n` +
              `  Available to Trade: ${availableBalance.toFixed(2)} USDT\n` +
              `  Wallet Balance: ${walletBalance.toFixed(2)} USDT\n` +
              `  Equity: ${equity.toFixed(2)} USDT\n` +
              `  Total Position IM: ${totalPositionIM.toFixed(2)} USDT\n` +
              `  Total Order IM: ${totalOrderIM.toFixed(2)} USDT\n` +
              `  Available to Withdraw: ${availableToWithdraw.toFixed(2)} USDT`
            );
          } else {
            this.logger.warn(`[BYBIT] No USDT found in UNIFIED account coins`);
          }
        } else {
          // CONTRACT account uses old structure
          availableBalance = parseFloat(account.totalAvailableBalance || '0');
          const totalEquity = parseFloat(account.totalEquity || '0');
          const totalWalletBalance = parseFloat(account.totalWalletBalance || '0');
          const totalMarginBalance = parseFloat(account.totalMarginBalance || '0');

          this.logger.log(
            `[BYBIT] ${accountType} Account Balance:\n` +
            `  Available for Trading: ${availableBalance.toFixed(2)} USD\n` +
            `  Total Equity: ${totalEquity.toFixed(2)} USD\n` +
            `  Total Wallet: ${totalWalletBalance.toFixed(2)} USD\n` +
            `  Total Margin: ${totalMarginBalance.toFixed(2)} USD`
          );
        }

        return availableBalance;
      }

      this.logger.warn(`[BYBIT] No account data returned from wallet balance endpoint`);
      return 0;
    } catch (error: any) {
      const statusCode = error.response?.status;
      const retCode = error.response?.data?.retCode;
      const retMsg = error.response?.data?.retMsg;
      const fullErrorData = error.response?.data;

      // Check for geo-blocking first
      if (this.isGeoBlockingError(error)) {
        this.logger.error(
          `[BYBIT] ⚠️⚠️⚠️  GEO-BLOCKING DETECTED  ⚠️⚠️⚠️\n` +
          `\n` +
          `  CloudFront is blocking access from your country/region!\n` +
          `  This is NOT an API key permission issue.\n` +
          `\n` +
          `  SOLUTIONS:\n` +
          `  1. Configure HTTP proxy in your .env file:\n` +
          `     HTTP_PROXY=http://proxy-server:port\n` +
          `     Example: HTTP_PROXY=http://myproxy.com:8080\n` +
          `\n` +
          `  2. Use a VPN to connect from an allowed country\n` +
          `\n` +
          `  3. Deploy bot to a server in an allowed region (US, EU, Asia)\n` +
          `\n` +
          `  After configuring proxy, restart the bot for changes to take effect.\n`
        );
        throw new Error('Bybit API blocked by geo-restriction. Configure HTTP_PROXY environment variable to use a proxy.');
      }

      // Log complete error details for debugging
      this.logger.error(
        `[BYBIT] Wallet Balance Request Failed:\n` +
        `  HTTP Status: ${statusCode}\n` +
        `  Bybit retCode: ${retCode}\n` +
        `  Bybit retMsg: ${retMsg}\n` +
        `  Full Response: ${typeof fullErrorData === 'string' ? fullErrorData.substring(0, 200) + '...' : JSON.stringify(fullErrorData, null, 2)}\n` +
        `  Request Headers: ${JSON.stringify({
          'X-BAPI-API-KEY': apiKey.substring(0, 8) + '...',
          'X-BAPI-TIMESTAMP': 'REDACTED',
          'X-BAPI-SIGN': 'REDACTED',
          'X-BAPI-RECV-WINDOW': this.RECV_WINDOW
        }, null, 2)}`
      );

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
          `  7. Check if your Bybit account has Unified Trading Account (UTA) enabled\n` +
          `  8. Verify your local server time is synchronized (check logs above for time sync)\n` +
          `\n` +
          `  Error Details: ${retMsg || error.message}`
        );
        throw new Error(`Bybit API Error: ${retMsg || error.message}`);
      }

      this.logger.error(`[BYBIT] Failed to get wallet balance: ${retMsg || error.message}`);
      throw new Error(`Failed to get Bybit wallet balance: ${retMsg || error.message}`);
    }
  }

  /**
   * Get Bybit server time to check if local time is synchronized
   */
  async getServerTime(isTestnet: boolean): Promise<number> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/market/time';
    const axiosConfig = this.getAxiosConfig();

    try {
      const response = await axios.get(`${baseUrl}${endpoint}`, axiosConfig);

      if (response.data.retCode !== 0) {
        this.logger.warn(`[BYBIT] Failed to get server time: ${response.data.retMsg}`);
        return Date.now();
      }

      const serverTime = parseInt(response.data.result.timeSecond) * 1000;
      const localTime = Date.now();
      const timeDiff = Math.abs(serverTime - localTime);

      this.logger.log(
        `[BYBIT] Time Sync Check:\n` +
        `  Server Time: ${new Date(serverTime).toISOString()}\n` +
        `  Local Time:  ${new Date(localTime).toISOString()}\n` +
        `  Difference:  ${timeDiff}ms ${timeDiff > 1000 ? '⚠️  WARNING: Time difference > 1 second!' : '✓ OK'}`
      );

      return serverTime;
    } catch (error: any) {
      if (this.isGeoBlockingError(error)) {
        this.logger.error(
          `[BYBIT] ⚠️  GEO-BLOCKING DETECTED ⚠️\n` +
          `  CloudFront is blocking access from your country/region!\n` +
          `\n` +
          `  SOLUTIONS:\n` +
          `  1. Configure a proxy/VPN by setting environment variable:\n` +
          `     HTTP_PROXY=http://your-proxy-host:port\n` +
          `     Example: HTTP_PROXY=http://proxy.example.com:8080\n` +
          `  2. Use a VPN service to connect from an allowed country\n` +
          `  3. Deploy your bot to a server in an allowed region\n` +
          `\n` +
          `  Error: ${error.message}`
        );
      } else {
        this.logger.error(`[BYBIT] Failed to get server time: ${error.message}`);
      }
      return Date.now();
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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

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

  async createStopLossOrder(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    qty: string,
    triggerPrice: string,
    hedgeMode?: boolean
  ): Promise<BybitOrderResponse> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/order/create';

    const positionIdx = await this.getPositionIdx(apiKey, apiSecret, isTestnet, symbol, side, hedgeMode);

    const oppositeSide = side === 'Buy' ? 'Sell' : 'Buy';
    const triggerDirection = side === 'Buy' ? 2 : 1;

    const body: Record<string, any> = {
      category: 'linear',
      symbol,
      side: oppositeSide,
      orderType: 'Market',
      qty,
      triggerPrice,
      triggerDirection,
      triggerBy: 'MarkPrice',
      positionIdx,
      reduceOnly: true,
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API Error: ${response.data.retMsg}`);
      }

      this.logger.log(`[BYBIT] Stop Loss order created: ${response.data.result.orderId} at trigger ${triggerPrice}`);
      return response.data.result;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to create SL order: ${error.response?.data?.retMsg || error.message}`);
      throw error;
    }
  }

  async setTradingStop(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    stopLoss?: string,
    takeProfit?: string,
    hedgeMode?: boolean
  ): Promise<boolean> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/trading-stop';

    const positionIdx = await this.getPositionIdx(apiKey, apiSecret, isTestnet, symbol, side, hedgeMode);

    const body: Record<string, any> = {
      category: 'linear',
      symbol,
      positionIdx,
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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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

  async clearTradingStop(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    side: 'Buy' | 'Sell',
    hedgeMode?: boolean
  ): Promise<boolean> {
    const baseUrl = this.getBaseUrl(isTestnet);
    const endpoint = '/v5/position/trading-stop';

    const positionIdx = await this.getPositionIdx(apiKey, apiSecret, isTestnet, symbol, side, hedgeMode);

    const body: Record<string, any> = {
      category: 'linear',
      symbol,
      positionIdx,
      stopLoss: '',
      takeProfit: ''
    };

    const bodyString = JSON.stringify(body);
    const headers = this.getHeaders(apiKey, apiSecret, bodyString);
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

      if (response.data.retCode === 0) {
        this.logger.log(`[BYBIT] Trading stop cleared for ${symbol}`);
        return true;
      }

      this.logger.warn(`[BYBIT] Clear trading stop response: ${response.data.retMsg}`);
      return false;
    } catch (error: any) {
      this.logger.error(`[BYBIT] Failed to clear trading stop: ${error.response?.data?.retMsg || error.message}`);
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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.get(`${baseUrl}${endpoint}?${queryString}`, axiosConfig);

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
    const axiosConfig = { ...this.getAxiosConfig(), headers };

    try {
      const response = await axios.post(`${baseUrl}${endpoint}`, body, axiosConfig);

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
