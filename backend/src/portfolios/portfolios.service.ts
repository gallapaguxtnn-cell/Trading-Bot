import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Portfolio, PortfolioMode } from './portfolio.entity';
import { PortfolioPublic, PortfolioSummary } from './portfolio-public.interface';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { EncryptionUtil } from '../utils/encryption.util';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { classifyConnectionError } from '../utils/connection-error.util';

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
  ) {}

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

  async testConnection(id: string): Promise<{ success: boolean; balance?: number; message?: string }> {
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
        const apiPassphrase = (await EncryptionUtil.decrypt(portfolio.apiPassphrase)).trim();
        const client = this.exchangeFactory.get(Exchange.OKX);
        const balance = await client.getWalletBalance({
          credentials: { apiKey, apiSecret, passphrase: apiPassphrase },
          mode: isTestnet ? 'DEMO' : 'REAL',
          region: (portfolio.region as any) ?? null,
        });
        return { success: true, balance };
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
