import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as ccxt from 'ccxt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ExchangeService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeService.name);
  private exchanges: Map<string, ccxt.Exchange> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('Initializing Exchange Service...');
    // In the future, load keys from DB. For now, we init a public client or testnet.
    // We can initialize a default testnet instance here if needed.
  }

  async getExchange(exchangeId: 'binance' | 'bybit', apiKey?: string, apiSecret?: string, isTestnet = true): Promise<ccxt.Exchange> {
    const key = `${exchangeId}-${apiKey ? apiKey.substring(0, 5) : 'public'}`;
    
    if (this.exchanges.has(key)) {
      return this.exchanges.get(key);
    }

    this.logger.log(`Creating new ${exchangeId} instance (Testnet: ${isTestnet})`);

    let exchangeClass: any;
    if (exchangeId === 'binance') exchangeClass = ccxt.binance;
    else if (exchangeId === 'bybit') exchangeClass = ccxt.bybit;
    else throw new Error(`Unsupported exchange: ${exchangeId}`);

    const exchange = new exchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      verbose: true, // DEBUG: Print request/response details
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
