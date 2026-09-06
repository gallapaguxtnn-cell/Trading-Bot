import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Portfolio, PortfolioMode } from '../portfolios/portfolio.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';

export interface ResolvedCredentials {
  apiKey: string;
  apiSecret: string;
  exchange: Exchange;
  isTestnet: boolean;
  isRealAccount: boolean;
  portfolioId: string | null;
  source: 'portfolio' | 'strategy';
}

export type StrategyCredentialsInput = Pick<
  Strategy,
  'portfolioId' | 'apiKey' | 'apiSecret' | 'exchange' | 'isTestnet' | 'isRealAccount'
>;

@Injectable()
export class CredentialsResolverService {
  private readonly logger = new Logger(CredentialsResolverService.name);

  constructor(
    @InjectRepository(Portfolio)
    private readonly portfoliosRepository: Repository<Portfolio>,
  ) {}

  async resolveCredentials(strategy: StrategyCredentialsInput): Promise<ResolvedCredentials> {
    if (strategy.portfolioId) {
      const portfolio = await this.portfoliosRepository
        .createQueryBuilder('portfolio')
        .addSelect(['portfolio.apiKey', 'portfolio.apiSecret'])
        .where('portfolio.id = :id', { id: strategy.portfolioId })
        .getOne();

      if (portfolio && portfolio.isActive) {
        const isTestnet = portfolio.mode === PortfolioMode.DEMO;
        this.logger.debug(`[CREDENTIALS] source=portfolio portfolioId=${portfolio.id}`);
        return {
          apiKey: portfolio.apiKey,
          apiSecret: portfolio.apiSecret,
          exchange: portfolio.exchange,
          isTestnet,
          isRealAccount: !isTestnet,
          portfolioId: portfolio.id,
          source: 'portfolio',
        };
      }

      this.logger.warn(
        `[CREDENTIALS] portfolioId=${strategy.portfolioId} nao encontrado ou inativo -- usando fallback das credenciais da estrategia`,
      );
    }

    return {
      apiKey: strategy.apiKey,
      apiSecret: strategy.apiSecret,
      exchange: strategy.exchange,
      isTestnet: strategy.isTestnet,
      isRealAccount: strategy.isRealAccount,
      portfolioId: null,
      source: 'strategy',
    };
  }
}
