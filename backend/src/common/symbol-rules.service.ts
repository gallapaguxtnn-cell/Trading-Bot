import { Injectable, Logger } from '@nestjs/common';
import { BybitClientService } from '../exchange/bybit-client.service';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { Exchange } from '../strategies/strategy.entity';

export interface SymbolRules {
  qtyStep: string;
  priceTick: string;
  minQty: string;
  minNotional: string;
}

const DEFAULT_RULES: SymbolRules = { qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' };
const SYMBOL_RULES_TTL_MS = 60 * 60 * 1000;
const BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
const BINANCE_MAINNET_URL = 'https://fapi.binance.com';

@Injectable()
export class SymbolRulesService {
  private readonly logger = new Logger(SymbolRulesService.name);
  private readonly rateLimiter = RateLimiterUtil.getInstance();

  constructor(private readonly bybitClient: BybitClientService) {}

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getSymbolRules(
    symbol: string,
    isTestnet: boolean,
    exchange: Exchange = Exchange.BINANCE
  ): Promise<SymbolRules> {
    const cacheKey = `rules:${exchange}:${symbol}`;

    const cached = this.rateLimiter.getCached<SymbolRules>(cacheKey);
    if (cached) {
      return cached;
    }

    if (exchange === Exchange.BYBIT) {
      try {
        await this.rateLimiter.throttle(`symbolRules:${symbol}`, 'bybit');
        const rules = await this.bybitClient.getSymbolRules(isTestnet, symbol);
        this.rateLimiter.setCached(cacheKey, rules, SYMBOL_RULES_TTL_MS);
        this.logger.log(`[BYBIT] Fetched rules for ${symbol}: Step=${rules.qtyStep}, Tick=${rules.priceTick}, MinNotional=${rules.minNotional}`);
        return rules;
      } catch (error: any) {
        this.logger.error(`[BYBIT] Failed to fetch symbol rules: ${error.message}`);
        return { ...DEFAULT_RULES };
      }
    }

    try {
      await this.rateLimiter.throttle('exchangeInfo', 'binance');
      await this.sleep(2000);

      const baseURL = isTestnet ? BINANCE_TESTNET_URL : BINANCE_MAINNET_URL;
      const response = await BinanceRequestUtil.get(`${baseURL}/fapi/v1/exchangeInfo`);
      const symbolInfo = response.data.symbols.find((s: any) => s.symbol === symbol);

      if (!symbolInfo) {
        this.logger.warn(`[BINANCE] Symbol ${symbol} not found in exchangeInfo. Using defaults.`);
        return { ...DEFAULT_RULES };
      }

      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');

      const rules: SymbolRules = {
        qtyStep: lotSizeFilter ? lotSizeFilter.stepSize : DEFAULT_RULES.qtyStep,
        minQty: lotSizeFilter ? lotSizeFilter.minQty : DEFAULT_RULES.minQty,
        priceTick: priceFilter ? priceFilter.tickSize : DEFAULT_RULES.priceTick,
        minNotional: minNotionalFilter ? minNotionalFilter.notional : DEFAULT_RULES.minNotional,
      };

      this.rateLimiter.setCached(cacheKey, rules, SYMBOL_RULES_TTL_MS);
      this.logger.log(`[BINANCE] Fetched rules for ${symbol}: Step=${rules.qtyStep}, Tick=${rules.priceTick}, MinNotional=${rules.minNotional}`);
      return rules;
    } catch (error: any) {
      this.logger.error(`[BINANCE] Failed to fetch symbol rules: ${error.message}`);
      return { ...DEFAULT_RULES };
    }
  }
}
