import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CredentialsResolverService } from './credentials-resolver.service';
import { Portfolio, PortfolioMode } from '../portfolios/portfolio.entity';
import { Exchange } from '../strategies/strategy.entity';

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

  beforeEach(async () => {
    portfoliosRepository = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsResolverService,
        { provide: getRepositoryToken(Portfolio), useValue: portfoliosRepository },
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
      exchange: Exchange.BINANCE,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
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
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: 'portfolio-1',
      source: 'portfolio',
    });
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
