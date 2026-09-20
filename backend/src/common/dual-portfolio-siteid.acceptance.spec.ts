jest.mock('axios');

import axios from 'axios';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CredentialsResolverService } from './credentials-resolver.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { Portfolio, PortfolioMode } from '../portfolios/portfolio.entity';
import { Exchange } from '../strategies/strategy.entity';

function createQueryBuilderMock(result: Partial<Portfolio>) {
  return {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

describe('Cenario de aceite (AUDITORIA_E_FECHAMENTO FASE 4): dois portfolios Bybit de entidades diferentes, simultaneos', () => {
  let credentialsResolver: CredentialsResolverService;
  let bybitClient: BybitClientService;
  let portfoliosRepository: { createQueryBuilder: jest.Mock };

  const braPortfolio: Partial<Portfolio> = {
    id: 'portfolio-bra',
    isActive: true,
    mode: PortfolioMode.REAL,
    exchange: Exchange.BYBIT,
    apiKey: 'bra-key',
    apiSecret: 'bra-secret',
    bybitSiteId: 'BRA_BTL',
  };

  const defaultPortfolio: Partial<Portfolio> = {
    id: 'portfolio-default',
    isActive: true,
    mode: PortfolioMode.REAL,
    exchange: Exchange.BYBIT,
    apiKey: 'default-key',
    apiSecret: 'default-secret',
    bybitSiteId: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    portfoliosRepository = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsResolverService,
        BybitClientService,
        { provide: getRepositoryToken(Portfolio), useValue: portfoliosRepository },
        // sem BYBIT_SITE_ID global: o unico jeito de uma conta ganhar o header e via portfolio
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    credentialsResolver = module.get(CredentialsResolverService);
    bybitClient = module.get(BybitClientService);

    (axios.get as jest.Mock).mockResolvedValue({ data: { retCode: 0, result: { list: [] } } });
  });

  it('portfolio BRA_BTL e portfolio padrao resolvem credenciais e siteId de forma independente, sem vazar um para o outro', async () => {
    const qbBra = createQueryBuilderMock(braPortfolio);
    const qbDefault = createQueryBuilderMock(defaultPortfolio);
    portfoliosRepository.createQueryBuilder
      .mockReturnValueOnce(qbBra)
      .mockReturnValueOnce(qbDefault);

    const [braCreds, defaultCreds] = await Promise.all([
      credentialsResolver.resolveCredentials({
        portfolioId: 'portfolio-bra',
        legacyApiKey: 'legacy-key',
        legacyApiSecret: 'legacy-secret',
        legacyExchange: Exchange.BYBIT,
        legacyIsTestnet: false,
        legacyIsRealAccount: true,
      }),
      credentialsResolver.resolveCredentials({
        portfolioId: 'portfolio-default',
        legacyApiKey: 'legacy-key',
        legacyApiSecret: 'legacy-secret',
        legacyExchange: Exchange.BYBIT,
        legacyIsTestnet: false,
        legacyIsRealAccount: true,
      }),
    ]);

    expect(braCreds).toMatchObject({ apiKey: 'bra-key', apiSecret: 'bra-secret', siteId: 'BRA_BTL' });
    expect(defaultCreds).toMatchObject({ apiKey: 'default-key', apiSecret: 'default-secret', siteId: null });
  });

  it('chamadas simultaneas de duas contas Bybit diferentes enviam x-site-id independentes -- nenhuma delas recebe "API key is invalid" por header errado', async () => {
    const qbBra = createQueryBuilderMock(braPortfolio);
    const qbDefault = createQueryBuilderMock(defaultPortfolio);
    portfoliosRepository.createQueryBuilder
      .mockReturnValueOnce(qbBra)
      .mockReturnValueOnce(qbDefault);

    const [braCreds, defaultCreds] = await Promise.all([
      credentialsResolver.resolveCredentials({
        portfolioId: 'portfolio-bra',
        legacyApiKey: 'legacy-key',
        legacyApiSecret: 'legacy-secret',
        legacyExchange: Exchange.BYBIT,
        legacyIsTestnet: false,
        legacyIsRealAccount: true,
      }),
      credentialsResolver.resolveCredentials({
        portfolioId: 'portfolio-default',
        legacyApiKey: 'legacy-key',
        legacyApiSecret: 'legacy-secret',
        legacyExchange: Exchange.BYBIT,
        legacyIsTestnet: false,
        legacyIsRealAccount: true,
      }),
    ]);

    await Promise.all([
      bybitClient.getPositions(braCreds.apiKey, braCreds.apiSecret, braCreds.isTestnet, 'SUIUSDT', braCreds.siteId),
      bybitClient.getPositions(defaultCreds.apiKey, defaultCreds.apiSecret, defaultCreds.isTestnet, 'SUIUSDT', defaultCreds.siteId),
    ]);

    const calls = (axios.get as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);

    const braCall = calls.find((c) => c[1].headers['X-BAPI-API-KEY'] === 'bra-key');
    const defaultCall = calls.find((c) => c[1].headers['X-BAPI-API-KEY'] === 'default-key');

    expect(braCall![1].headers['x-site-id']).toBe('BRA_BTL');
    expect(defaultCall![1].headers['x-site-id']).toBeUndefined();
  });
});
