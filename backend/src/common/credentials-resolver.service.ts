import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Portfolio, PortfolioMode } from '../portfolios/portfolio.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import type { ResolvedStrategy } from './resolved-strategy.type';

const RESOLVED_STRATEGY_CACHE_PREFIX = 'resolved-strategy:';
const RESOLVED_STRATEGY_CACHE_TTL_MS = 45 * 1000;

export interface ResolvedCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string | null;
  exchange: Exchange;
  isTestnet: boolean;
  isRealAccount: boolean;
  portfolioId: string | null;
  siteId: string | null;
  source: 'portfolio' | 'strategy';
}

export type StrategyCredentialsInput = Pick<
  Strategy,
  'portfolioId' | 'legacyApiKey' | 'legacyApiSecret' | 'legacyExchange' | 'legacyIsTestnet' | 'legacyIsRealAccount'
>;

const LEGACY_DISPLAY_COLUMNS = ['legacyExchange', 'legacyIsTestnet', 'legacyIsRealAccount'] as const;

export const STRATEGY_CREDENTIAL_SELECT_COLUMNS = [...LEGACY_DISPLAY_COLUMNS, 'legacyApiKey', 'legacyApiSecret'] as const;

export const STRATEGY_CREDENTIAL_ADD_SELECT = ['strategy.legacyApiKey', 'strategy.legacyApiSecret'] as const;

export function fromLegacyStrategyFields<T extends Pick<Strategy, (typeof LEGACY_DISPLAY_COLUMNS)[number]>>(
  strategy: T,
): Omit<T, (typeof LEGACY_DISPLAY_COLUMNS)[number]> & { exchange: Exchange; isTestnet: boolean; isRealAccount: boolean } {
  const { legacyExchange, legacyIsTestnet, legacyIsRealAccount, ...rest } = strategy;
  return { ...rest, exchange: legacyExchange, isTestnet: legacyIsTestnet, isRealAccount: legacyIsRealAccount };
}

export interface StrategyWireCredentialFields {
  exchange?: Exchange;
  apiKey?: string;
  apiSecret?: string;
  isTestnet?: boolean;
  isRealAccount?: boolean;
}

export function toLegacyStrategyFields(
  input: StrategyWireCredentialFields,
): Partial<Pick<Strategy, 'legacyExchange' | 'legacyApiKey' | 'legacyApiSecret' | 'legacyIsTestnet' | 'legacyIsRealAccount'>> {
  const fields: Partial<Pick<Strategy, 'legacyExchange' | 'legacyApiKey' | 'legacyApiSecret' | 'legacyIsTestnet' | 'legacyIsRealAccount'>> = {};
  if (input.exchange !== undefined) fields.legacyExchange = input.exchange;
  if (input.apiKey !== undefined) fields.legacyApiKey = input.apiKey;
  if (input.apiSecret !== undefined) fields.legacyApiSecret = input.apiSecret;
  if (input.isTestnet !== undefined) fields.legacyIsTestnet = input.isTestnet;
  if (input.isRealAccount !== undefined) fields.legacyIsRealAccount = input.isRealAccount;
  return fields;
}

@Injectable()
export class CredentialsResolverService {
  private readonly logger = new Logger(CredentialsResolverService.name);

  constructor(
    @InjectRepository(Portfolio)
    private readonly portfoliosRepository: Repository<Portfolio>,
    private readonly configService: ConfigService,
  ) {}

  private resolveSiteId(portfolioSiteId?: string | null): string | null {
    return (
      portfolioSiteId ||
      this.configService.get<string>('BYBIT_SITE_ID') ||
      process.env.BYBIT_SITE_ID ||
      null
    );
  }

  async resolveCredentials(strategy: StrategyCredentialsInput): Promise<ResolvedCredentials> {
    if (strategy.portfolioId) {
      const portfolio = await this.portfoliosRepository
        .createQueryBuilder('portfolio')
        .addSelect(['portfolio.apiKey', 'portfolio.apiSecret', 'portfolio.apiPassphrase'])
        .where('portfolio.id = :id', { id: strategy.portfolioId })
        .getOne();

      if (portfolio && portfolio.isActive) {
        const isTestnet = portfolio.mode === PortfolioMode.DEMO;
        this.logger.debug(`[CREDENTIALS] source=portfolio portfolioId=${portfolio.id}`);
        return {
          apiKey: portfolio.apiKey,
          apiSecret: portfolio.apiSecret,
          apiPassphrase: portfolio.apiPassphrase ?? null,
          exchange: portfolio.exchange,
          isTestnet,
          isRealAccount: !isTestnet,
          portfolioId: portfolio.id,
          siteId: this.resolveSiteId(portfolio.region || portfolio.bybitSiteId),
          source: 'portfolio',
        };
      }

      this.logger.warn(
        `[CREDENTIALS] portfolioId=${strategy.portfolioId} nao encontrado ou inativo -- usando fallback das credenciais da estrategia`,
      );
    }

    return {
      apiKey: strategy.legacyApiKey,
      apiSecret: strategy.legacyApiSecret,
      apiPassphrase: null,
      exchange: strategy.legacyExchange,
      isTestnet: strategy.legacyIsTestnet,
      isRealAccount: strategy.legacyIsRealAccount,
      portfolioId: null,
      siteId: this.resolveSiteId(null),
      source: 'strategy',
    };
  }

  async resolve(strategy: Strategy): Promise<ResolvedStrategy> {
    const cacheKey = `${RESOLVED_STRATEGY_CACHE_PREFIX}${strategy.id}`;
    const cached = RateLimiterUtil.getInstance().getCached<ResolvedStrategy>(cacheKey);
    if (cached) return cached;

    const credentials = await this.resolveCredentials(strategy);
    const resolved: ResolvedStrategy = { ...strategy, ...credentials };

    RateLimiterUtil.getInstance().setCached(cacheKey, resolved, RESOLVED_STRATEGY_CACHE_TTL_MS);
    return resolved;
  }

  invalidate(strategyId?: string): void {
    if (strategyId) {
      RateLimiterUtil.getInstance().clearCache(`${RESOLVED_STRATEGY_CACHE_PREFIX}${strategyId}`);
      return;
    }
    RateLimiterUtil.getInstance().clearCache(RESOLVED_STRATEGY_CACHE_PREFIX);
  }
}
