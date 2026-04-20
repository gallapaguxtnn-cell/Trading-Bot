import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ProxyUtil } from '../utils/proxy.util';

@Injectable()
export class ExchangeService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeService.name);
  private exchanges: Map<string, ccxt.Exchange> = new Map();

  constructor(private configService: ConfigService) {}

  /**
   * Generate a secure cache key using a hash of the full API key
   * This prevents collisions when API keys share the same prefix
   */
  private getCacheKey(exchangeId: string, apiKey?: string): string {
    if (!apiKey) {
      return `${exchangeId}-public`;
    }
    // Use SHA256 hash of the full API key for uniqueness
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
    return `${exchangeId}-${hash}`;
  }

  async onModuleInit() {
    this.logger.log('Initializing Exchange Service...');
    // In the future, load keys from DB. For now, we init a public client or testnet.
    // We can initialize a default testnet instance here if needed.
  }

  async getExchange(exchangeId: 'binance' | 'bybit', apiKey?: string, apiSecret?: string, isTestnet = true): Promise<ccxt.Exchange> {
    const key = this.getCacheKey(exchangeId, apiKey);

    if (this.exchanges.has(key)) {
      return this.exchanges.get(key);
    }

    this.logger.log(`Creating new ${exchangeId} instance (Testnet: ${isTestnet})`);

    let exchangeClass: any;
    if (exchangeId === 'binance') exchangeClass = ccxt.binance;
    else if (exchangeId === 'bybit') exchangeClass = ccxt.bybit;
    else throw new Error(`Unsupported exchange: ${exchangeId}`);

    // Only enable verbose mode in development for debugging
    const isDebugMode = this.configService.get<string>('NODE_ENV') === 'development' ||
                        this.configService.get<boolean>('CCXT_VERBOSE') === true;

    // Get proxy agent if proxy is enabled
    const httpsAgent = ProxyUtil.getHttpsAgent();
    const proxyEnabled = ProxyUtil.isEnabled();

    if (proxyEnabled) {
      this.logger.log(`[PROXY] Using proxy for ${exchangeId} CCXT instance`);
    }

    const exchange = new exchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      verbose: isDebugMode,
      agent: httpsAgent, // Use proxy agent if available
      options: {
        defaultType: 'future', // Default to futures
      },
    });

    if (isTestnet && exchangeId === 'binance') {
        const testnetBase = 'https://testnet.binancefuture.com';

        exchange.has['fetchCurrencies'] = false;

        exchange.urls['api']['fapiPublic'] = testnetBase + '/fapi/v1';
        exchange.urls['api']['fapiPrivate'] = testnetBase + '/fapi/v1';
        exchange.urls['api']['fapiPrivateV2'] = testnetBase + '/fapi/v2';
        exchange.urls['api']['fapiData'] = testnetBase + '/fapi/v1';
    } else if (isTestnet && exchangeId === 'bybit') {
        exchange.setSandboxMode(true);
        this.logger.log('[BYBIT TESTNET] Sandbox mode enabled');
    }

    if (apiKey && apiSecret) {
        // Authenticated check
        try {
           // await exchange.fetchBalance(); // Validate keys
        } catch (e) {
            this.logger.error(`Failed to validate keys for ${exchangeId}`, e);
        }
    }

    this.exchanges.set(key, exchange);
    return exchange;
  }
}
