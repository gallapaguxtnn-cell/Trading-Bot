import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CredentialsResolverService } from './credentials-resolver.service';
import { Portfolio, PortfolioMode } from '../portfolios/portfolio.entity';
import { Exchange } from '../strategies/strategy.entity';
import { RateLimiterUtil } from '../utils/rate-limiter.util';

function createQueryBuilderMock(result: any) {
  return {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

describe('CredentialsResolverService', () => {
  let service: CredentialsResolverService;
  let portfoliosRepository: { createQueryBuilder: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    portfoliosRepository = { createQueryBuilder: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsResolverService,
        { provide: getRepositoryToken(Portfolio), useValue: portfoliosRepository },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<CredentialsResolverService>(CredentialsResolverService);
  });

  it('sem portfolioId: usa as credenciais legadas da estrategia (comportamento atual preservado)', async () => {
    const result = await service.resolveCredentials({
      portfolioId: null,
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(portfoliosRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(result).toEqual({
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      apiPassphrase: null,
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });
  });

  it('com portfolio ativo: usa as credenciais do portfolio e mapeia DEMO -> isTestnet true', async () => {
    const qb = createQueryBuilderMock({
      id: 'portfolio-1',
      isActive: true,
      mode: PortfolioMode.DEMO,
      exchange: Exchange.BYBIT,
      apiKey: 'portfolio-key',
      apiSecret: 'portfolio-secret',
      bybitSiteId: null,
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-1',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: false,
      isRealAccount: true,
    });

    expect(result).toEqual({
      apiKey: 'portfolio-key',
      apiSecret: 'portfolio-secret',
      apiPassphrase: null,
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: 'portfolio-1',
      siteId: null,
      source: 'portfolio',
    });
  });

  it('portfolio com bybitSiteId (BRA_BTL): siteId do portfolio tem prioridade sobre a env', async () => {
    configService.get.mockReturnValue('ENV_SITE');
    const qb = createQueryBuilderMock({
      id: 'portfolio-bra',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.BYBIT,
      apiKey: 'k',
      apiSecret: 's',
      bybitSiteId: 'BRA_BTL',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-bra',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: false,
      isRealAccount: true,
    });

    expect(result.siteId).toBe('BRA_BTL');
  });

  it('portfolio com region (FASE 3): tem precedencia sobre bybitSiteId legado e sobre a env', async () => {
    configService.get.mockReturnValue('ENV_SITE');
    const qb = createQueryBuilderMock({
      id: 'portfolio-region',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.OKX,
      apiKey: 'k',
      apiSecret: 's',
      apiPassphrase: 'p',
      bybitSiteId: 'ARG_BTL',
      region: 'EL_SALVADOR',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-region',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: false,
      isRealAccount: true,
    });

    expect(result.siteId).toBe('EL_SALVADOR');
    expect(result.apiPassphrase).toBe('p');
  });

  it('portfolio sem region nem bybitSiteId: apiPassphrase null (comportamento atual para Bybit/Binance)', async () => {
    const qb = createQueryBuilderMock({
      id: 'portfolio-nopass',
      isActive: true,
      mode: PortfolioMode.DEMO,
      exchange: Exchange.BYBIT,
      apiKey: 'k',
      apiSecret: 's',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-nopass',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.apiPassphrase).toBeNull();
  });

  it('portfolio sem bybitSiteId: cai para a env BYBIT_SITE_ID', async () => {
    configService.get.mockReturnValue('ENV_SITE');
    const qb = createQueryBuilderMock({
      id: 'portfolio-default',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.BYBIT,
      apiKey: 'k',
      apiSecret: 's',
      bybitSiteId: null,
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-default',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: false,
      isRealAccount: true,
    });

    expect(result.siteId).toBe('ENV_SITE');
  });

  it('sem portfolio e sem env: siteId null (comportamento atual)', async () => {
    configService.get.mockReturnValue(undefined);

    const result = await service.resolveCredentials({
      portfolioId: null,
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.siteId).toBeNull();
  });

  it('dois portfolios de entidades diferentes resolvem siteId de forma independente e simultanea', async () => {
    const qbBra = createQueryBuilderMock({
      id: 'portfolio-bra',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.BYBIT,
      apiKey: 'k1',
      apiSecret: 's1',
      bybitSiteId: 'BRA_BTL',
    } as Portfolio);
    const qbDefault = createQueryBuilderMock({
      id: 'portfolio-default',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.BYBIT,
      apiKey: 'k2',
      apiSecret: 's2',
      bybitSiteId: null,
    } as Portfolio);

    portfoliosRepository.createQueryBuilder
      .mockReturnValueOnce(qbBra)
      .mockReturnValueOnce(qbDefault);

    const [braResult, defaultResult] = await Promise.all([
      service.resolveCredentials({
        portfolioId: 'portfolio-bra',
        apiKey: 'strategy-key',
        apiSecret: 'strategy-secret',
        exchange: Exchange.BINANCE,
        isTestnet: false,
        isRealAccount: true,
      }),
      service.resolveCredentials({
        portfolioId: 'portfolio-default',
        apiKey: 'strategy-key',
        apiSecret: 'strategy-secret',
        exchange: Exchange.BINANCE,
        isTestnet: false,
        isRealAccount: true,
      }),
    ]);

    expect(braResult.siteId).toBe('BRA_BTL');
    expect(defaultResult.siteId).toBeNull();
  });

  it('com portfolio REAL: isTestnet false e isRealAccount true', async () => {
    const qb = createQueryBuilderMock({
      id: 'portfolio-2',
      isActive: true,
      mode: PortfolioMode.REAL,
      exchange: Exchange.BYBIT,
      apiKey: 'k',
      apiSecret: 's',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-2',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.isTestnet).toBe(false);
    expect(result.isRealAccount).toBe(true);
    expect(result.source).toBe('portfolio');
  });

  it('portfolio inativo: cai para o fallback da estrategia', async () => {
    const qb = createQueryBuilderMock({
      id: 'portfolio-3',
      isActive: false,
      mode: PortfolioMode.DEMO,
      exchange: Exchange.BYBIT,
      apiKey: 'portfolio-key',
      apiSecret: 'portfolio-secret',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-3',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.source).toBe('strategy');
    expect(result.apiKey).toBe('strategy-key');
  });

  it('portfolioId aponta para um portfolio inexistente (apagado): cai para o fallback da estrategia', async () => {
    const qb = createQueryBuilderMock(null);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolveCredentials({
      portfolioId: 'portfolio-deleted',
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.source).toBe('strategy');
  });

  it('estrategia sem credenciais e sem portfolio: devolve campos vazios sem lancar', async () => {
    const result = await service.resolveCredentials({
      portfolioId: null,
      apiKey: null as unknown as string,
      apiSecret: null as unknown as string,
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
    });

    expect(result.apiKey).toBeNull();
    expect(result.apiSecret).toBeNull();
    expect(result.source).toBe('strategy');
  });
});

describe('CredentialsResolverService.resolve (PLANO_DEFINITIVO_CORRETORAS -- FASE 2: ResolvedStrategy com cache)', () => {
  let service: CredentialsResolverService;
  let portfoliosRepository: { createQueryBuilder: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    RateLimiterUtil.getInstance().clearCache();
    portfoliosRepository = { createQueryBuilder: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsResolverService,
        { provide: getRepositoryToken(Portfolio), useValue: portfoliosRepository },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<CredentialsResolverService>(CredentialsResolverService);
  });

  afterEach(() => {
    RateLimiterUtil.getInstance().clearCache();
  });

  function makeStrategy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'strategy-1',
      name: 'FF1 1H',
      portfolioId: null,
      apiKey: 'strategy-key',
      apiSecret: 'strategy-secret',
      exchange: Exchange.OKX,
      isTestnet: false,
      isRealAccount: true,
      stopLossPercentage: 2,
      ...overrides,
    } as any;
  }

  it('devolve a estrategia mesclada com as credenciais resolvidas (ResolvedStrategy completo, nao so ResolvedCredentials)', async () => {
    const resolved = await service.resolve(makeStrategy());

    expect(resolved.id).toBe('strategy-1');
    expect(resolved.name).toBe('FF1 1H');
    expect(resolved.stopLossPercentage).toBe(2);
    expect(resolved.exchange).toBe(Exchange.OKX);
    expect(resolved.apiKey).toBe('strategy-key');
    expect(resolved.source).toBe('strategy');
  });

  it('segunda chamada para a mesma estrategia usa o cache -- nao consulta o portfolio de novo', async () => {
    const qb = createQueryBuilderMock({
      id: 'portfolio-1', isActive: true, mode: PortfolioMode.DEMO, exchange: Exchange.BYBIT, apiKey: 'pk', apiSecret: 'ps',
    } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const strategy = makeStrategy({ portfolioId: 'portfolio-1' });
    const first = await service.resolve(strategy);
    const second = await service.resolve(strategy);

    expect(portfoliosRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('estrategias diferentes tem entradas de cache independentes', async () => {
    const qb1 = createQueryBuilderMock({ id: 'p1', isActive: true, mode: PortfolioMode.DEMO, exchange: Exchange.BYBIT, apiKey: 'k1', apiSecret: 's1' } as Portfolio);
    const qb2 = createQueryBuilderMock({ id: 'p2', isActive: true, mode: PortfolioMode.REAL, exchange: Exchange.OKX, apiKey: 'k2', apiSecret: 's2' } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValueOnce(qb1).mockReturnValueOnce(qb2);

    const resolvedA = await service.resolve(makeStrategy({ id: 'strategy-a', portfolioId: 'p1' }));
    const resolvedB = await service.resolve(makeStrategy({ id: 'strategy-b', portfolioId: 'p2' }));

    expect(resolvedA.apiKey).toBe('k1');
    expect(resolvedB.apiKey).toBe('k2');
  });

  it('invalidate(strategyId): forca nova consulta so para aquela estrategia', async () => {
    const qb = createQueryBuilderMock({ id: 'portfolio-1', isActive: true, mode: PortfolioMode.DEMO, exchange: Exchange.BYBIT, apiKey: 'pk', apiSecret: 'ps' } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

    const strategy = makeStrategy({ portfolioId: 'portfolio-1' });
    await service.resolve(strategy);
    service.invalidate('strategy-1');
    await service.resolve(strategy);

    expect(portfoliosRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
  });

  it('invalidate() sem argumento limpa TODAS as estrategias em cache (mudanca de portfolio compartilhado)', async () => {
    const qb1 = createQueryBuilderMock({ id: 'p1', isActive: true, mode: PortfolioMode.DEMO, exchange: Exchange.BYBIT, apiKey: 'k1', apiSecret: 's1' } as Portfolio);
    const qb2 = createQueryBuilderMock({ id: 'p1', isActive: true, mode: PortfolioMode.DEMO, exchange: Exchange.BYBIT, apiKey: 'k1-novo', apiSecret: 's1' } as Portfolio);
    portfoliosRepository.createQueryBuilder.mockReturnValueOnce(qb1).mockReturnValueOnce(qb2).mockReturnValueOnce(qb2);

    const strategyX = makeStrategy({ id: 'strategy-x', portfolioId: 'p1' });
    const strategyY = makeStrategy({ id: 'strategy-y', portfolioId: 'p1' });
    await service.resolve(strategyX);
    await service.resolve(strategyY);

    service.invalidate();

    const resolvedXAgain = await service.resolve(strategyX);
    expect(resolvedXAgain.apiKey).toBe('k1-novo');
    expect(portfoliosRepository.createQueryBuilder).toHaveBeenCalledTimes(3);
  });
});
