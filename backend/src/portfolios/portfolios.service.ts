import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Portfolio, PortfolioMode } from './portfolio.entity';
import { PortfolioPublic, PortfolioSummary } from './portfolio-public.interface';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { OkxClientService } from '../exchange/okx-client.service';
import { classifyConnectionError } from '../utils/connection-error.util';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { RateLimiterUtil } from '../utils/rate-limiter.util';

const PORTFOLIO_BALANCE_TTL_MS = 30000;

const PORTFOLIO_PUBLIC_COLUMNS = [
  'id',
  'name',
  'exchange',
  'mode',
  'isActive',
  'bybitSiteId',
  'region',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class PortfoliosService {
  private readonly logger = new Logger(PortfoliosService.name);

  constructor(
    @InjectRepository(Portfolio)
    private readonly portfoliosRepository: Repository<Portfolio>,
    @InjectRepository(Strategy)
    private readonly strategiesRepository: Repository<Strategy>,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeFactory: ExchangeClientFactory,
    private readonly okxClientService: OkxClientService,
    private readonly credentialsResolver: CredentialsResolverService,
  ) {}

  private readonly rateLimiter = RateLimiterUtil.getInstance();

  private async maskApiKey(encryptedApiKey: string | null | undefined): Promise<string> {
    if (!encryptedApiKey) return '';
    const decrypted = await EncryptionUtil.decrypt(encryptedApiKey);
    return `${decrypted.slice(0, 5)}••••••`;
  }

  async findAllPublic(): Promise<PortfolioPublic[]> {
    const portfolios = await this.portfoliosRepository
      .createQueryBuilder('portfolio')
      .select(PORTFOLIO_PUBLIC_COLUMNS.map((column) => `portfolio.${column}`))
      .addSelect('portfolio.apiKey')
      .orderBy('portfolio.createdAt', 'DESC')
      .getMany();

    return Promise.all(
      portfolios.map(async (portfolio) => ({
        id: portfolio.id,
        name: portfolio.name,
        exchange: portfolio.exchange,
        mode: portfolio.mode,
        isActive: portfolio.isActive,
        bybitSiteId: portfolio.bybitSiteId,
        region: portfolio.region,
        createdAt: portfolio.createdAt,
        updatedAt: portfolio.updatedAt,
        apiKeyMasked: await this.maskApiKey(portfolio.apiKey),
      })),
    );
  }

  async findOnePublic(id: string): Promise<PortfolioPublic | null> {
    const portfolio = await this.portfoliosRepository
      .createQueryBuilder('portfolio')
      .select(PORTFOLIO_PUBLIC_COLUMNS.map((column) => `portfolio.${column}`))
      .addSelect('portfolio.apiKey')
      .where('portfolio.id = :id', { id })
      .getOne();

    if (!portfolio) return null;

    return {
      id: portfolio.id,
      name: portfolio.name,
      exchange: portfolio.exchange,
      mode: portfolio.mode,
      isActive: portfolio.isActive,
      bybitSiteId: portfolio.bybitSiteId,
      region: portfolio.region,
      createdAt: portfolio.createdAt,
      updatedAt: portfolio.updatedAt,
      apiKeyMasked: await this.maskApiKey(portfolio.apiKey),
    };
  }

  async findSummariesByIds(ids: string[]): Promise<Map<string, PortfolioSummary>> {
    if (ids.length === 0) return new Map();
    const portfolios = await this.portfoliosRepository.find({
      where: { id: In(ids) },
      select: ['id', 'name', 'exchange', 'mode'],
    });
    return new Map(portfolios.map((p) => [p.id, { id: p.id, name: p.name, exchange: p.exchange, mode: p.mode }]));
  }

  findWithCredentials(id: string): Promise<Portfolio | null> {
    return this.portfoliosRepository
      .createQueryBuilder('portfolio')
      .addSelect(['portfolio.apiKey', 'portfolio.apiSecret', 'portfolio.apiPassphrase'])
      .where('portfolio.id = :id', { id })
      .getOne();
  }

  private assertOkxHasPassphrase(exchange: Exchange | undefined, passphrase: string | null | undefined): void {
    if (exchange === Exchange.OKX && !passphrase) {
      throw new BadRequestException('Portfólios OKX exigem a Passphrase da API, além da API Key e do Secret.');
    }
  }

  async create(data: Partial<Portfolio>): Promise<PortfolioPublic | null> {
    this.assertOkxHasPassphrase(data.exchange, data.apiPassphrase);

    const portfolio = this.portfoliosRepository.create(data);
    if (portfolio.apiKey) {
      portfolio.apiKey = await EncryptionUtil.encrypt(portfolio.apiKey);
    }
    if (portfolio.apiSecret) {
      portfolio.apiSecret = await EncryptionUtil.encrypt(portfolio.apiSecret);
    }
    if (portfolio.apiPassphrase) {
      portfolio.apiPassphrase = await EncryptionUtil.encrypt(portfolio.apiPassphrase);
    }
    const saved = await this.portfoliosRepository.save(portfolio);
    return this.findOnePublic(saved.id);
  }

  async update(id: string, data: Partial<Portfolio>): Promise<PortfolioPublic | null> {
    const update: Partial<Portfolio> = { ...data };

    if (update.exchange !== undefined || update.mode !== undefined) {
      const existing = await this.findWithCredentials(id);
      const effectiveExchange = update.exchange ?? existing?.exchange;
      this.assertOkxHasPassphrase(effectiveExchange, update.apiPassphrase || existing?.apiPassphrase);
    }

    if (update.apiKey) {
      update.apiKey = await EncryptionUtil.encrypt(update.apiKey);
    } else {
      delete update.apiKey;
    }
    if (update.apiSecret) {
      update.apiSecret = await EncryptionUtil.encrypt(update.apiSecret);
    } else {
      delete update.apiSecret;
    }
    if (update.apiPassphrase) {
      update.apiPassphrase = await EncryptionUtil.encrypt(update.apiPassphrase);
    } else {
      delete update.apiPassphrase;
    }
    await this.portfoliosRepository.update(id, update);
    this.credentialsResolver.invalidate();
    return this.findOnePublic(id);
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const linkedStrategies = await this.strategiesRepository.count({ where: { portfolioId: id } });
    if (linkedStrategies > 0) {
      throw new ConflictException(
        `Não é possível excluir: ${linkedStrategies} estratégia(s) ainda vinculada(s) a este portfólio.`,
      );
    }
    await this.portfoliosRepository.delete(id);
    return { success: true };
  }

  async testConnection(id: string, force = false): Promise<{
    success: boolean;
    balance?: number;
    message?: string;
    instrument?: { ctVal: string; ctMult: string; lotSz: string; minSz: string; tickSz: string };
  }> {
    const cacheKey = `portfolio:testConnection:${id}`;

    if (!force) {
      const cached = this.rateLimiter.getCached<{
        success: boolean;
        balance?: number;
        message?: string;
        instrument?: { ctVal: string; ctMult: string; lotSz: string; minSz: string; tickSz: string };
      }>(cacheKey);
      if (cached) return cached;
    }

    const result = await this.runConnectionCheck(id);
    this.rateLimiter.setCached(cacheKey, result, PORTFOLIO_BALANCE_TTL_MS);
    return result;
  }

  private async runConnectionCheck(id: string): Promise<{
    success: boolean;
    balance?: number;
    message?: string;
    instrument?: { ctVal: string; ctMult: string; lotSz: string; minSz: string; tickSz: string };
  }> {
    const portfolio = await this.findWithCredentials(id);
    if (!portfolio) {
      throw new NotFoundException('Portfolio not found');
    }
    if (!portfolio.apiKey || !portfolio.apiSecret) {
      return { success: false, message: 'Portfólio sem credenciais configuradas' };
    }

    const apiKey = (await EncryptionUtil.decrypt(portfolio.apiKey)).trim();
    const apiSecret = (await EncryptionUtil.decrypt(portfolio.apiSecret)).trim();
    const isTestnet = portfolio.mode === PortfolioMode.DEMO;

    try {
      if (portfolio.exchange === Exchange.BYBIT) {
        const siteId = portfolio.region || portfolio.bybitSiteId || process.env.BYBIT_SITE_ID || null;
        const client = this.exchangeFactory.get(Exchange.BYBIT);
        const balance = await client.getWalletBalance({ credentials: { apiKey, apiSecret }, mode: isTestnet ? 'DEMO' : 'REAL', region: siteId as any });
        return { success: true, balance };
      }
      if (portfolio.exchange === Exchange.BINANCE) {
        const exchange = await this.exchangeService.getExchange('binance', apiKey, apiSecret, isTestnet);
        const balanceInfo = await exchange.fetchBalance();
        const balance = balanceInfo?.total?.USDT ?? 0;
        return { success: true, balance };
      }
      if (portfolio.exchange === Exchange.OKX) {
        if (!portfolio.apiPassphrase) {
          return { success: false, message: 'Portfólio OKX sem Passphrase configurada' };
        }
        const region = (portfolio.region as any) ?? null;

        let instrument: { ctVal: string; ctMult: string; lotSz: string; minSz: string; tickSz: string };
        try {
          instrument = await this.okxClientService.getPublicInstrumentInfo(region, 'BTCUSDT');
        } catch (publicError: any) {
          const classified = classifyConnectionError(publicError);
          const message = classified?.message
            ?? `Falha ao alcançar o endpoint público da OKX (rede/proxy): ${publicError.message}`;
          this.logger.warn(`[TEST CONNECTION] OKX (etapa pública) falhou para portfólio ${id}: ${message}`);
          return { success: false, message };
        }

        const apiPassphrase = (await EncryptionUtil.decrypt(portfolio.apiPassphrase)).trim();
        const balance = await this.okxClientService.getWalletBalance({
          credentials: { apiKey, apiSecret, passphrase: apiPassphrase },
          mode: isTestnet ? 'DEMO' : 'REAL',
          region,
        });
        return { success: true, balance, instrument };
      }
      return { success: false, message: `Corretora ${portfolio.exchange} ainda não é suportada` };
    } catch (error: any) {
      const classified = classifyConnectionError(error);
      const message = classified?.message ?? (error.message || 'Falha ao validar credenciais');
      this.logger.warn(`[TEST CONNECTION] Falha ao validar portfólio ${id}: ${message}`);
      return { success: false, message };
    }
  }
}
