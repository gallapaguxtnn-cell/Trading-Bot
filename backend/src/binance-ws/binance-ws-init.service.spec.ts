import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BinanceWebSocketInitService } from './binance-ws-init.service';
import { BinanceWebSocketService } from './binance-ws.service';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { EncryptionUtil } from '../utils/encryption.util';

describe('BinanceWebSocketInitService (FASE 2 -- CredentialsResolver)', () => {
  let service: BinanceWebSocketInitService;
  let strategiesRepository: { createQueryBuilder: jest.Mock };
  let binanceWs: { isEnabled: jest.Mock; subscribeUserDataStream: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };

  function makeQueryBuilder(strategies: any[]) {
    return {
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(strategies),
    };
  }

  beforeEach(async () => {
    strategiesRepository = { createQueryBuilder: jest.fn() };
    binanceWs = { isEnabled: jest.fn().mockReturnValue(true), subscribeUserDataStream: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BinanceWebSocketInitService,
        { provide: getRepositoryToken(Strategy), useValue: strategiesRepository },
        { provide: BinanceWebSocketService, useValue: binanceWs },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<BinanceWebSocketInitService>(BinanceWebSocketInitService);
  });

  it('estrategia com portfolio Binance (mesmo com exchange legado = bybit): assina o user data stream com as credenciais do portfolio', async () => {
    const strategy = {
      id: 's1', name: 'Estrategia X', exchange: Exchange.BYBIT, isTestnet: true,
      apiKey: 'legacy-key', apiSecret: 'legacy-secret', portfolioId: 'p1',
    } as unknown as Strategy;
    strategiesRepository.createQueryBuilder.mockReturnValue(makeQueryBuilder([strategy]));
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: await EncryptionUtil.encrypt('portfolio-key'),
      apiSecret: await EncryptionUtil.encrypt('portfolio-secret'),
      exchange: Exchange.BINANCE,
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'p1',
      source: 'portfolio',
    });

    await service.onModuleInit();

    expect(binanceWs.subscribeUserDataStream).toHaveBeenCalledWith('s1', 'portfolio-key', 'portfolio-secret', false);
  });

  it('estrategia com portfolio Bybit: nao assina o user data stream da Binance', async () => {
    const strategy = {
      id: 's2', name: 'Estrategia Y', exchange: Exchange.BINANCE, isTestnet: true,
      apiKey: 'legacy-key', apiSecret: 'legacy-secret', portfolioId: 'p2',
    } as unknown as Strategy;
    strategiesRepository.createQueryBuilder.mockReturnValue(makeQueryBuilder([strategy]));
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'portfolio-key', apiSecret: 'portfolio-secret', exchange: Exchange.BYBIT,
      isTestnet: false, isRealAccount: true, portfolioId: 'p2', source: 'portfolio',
    });

    await service.onModuleInit();

    expect(binanceWs.subscribeUserDataStream).not.toHaveBeenCalled();
  });

  it('sem portfolio: usa exchange/credenciais legadas da estrategia (comportamento atual preservado)', async () => {
    const strategy = {
      id: 's3', name: 'Legada', exchange: Exchange.BINANCE, isTestnet: true,
      apiKey: await EncryptionUtil.encrypt('legacy-key'),
      apiSecret: await EncryptionUtil.encrypt('legacy-secret'),
      portfolioId: null,
    } as unknown as Strategy;
    strategiesRepository.createQueryBuilder.mockReturnValue(makeQueryBuilder([strategy]));
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: strategy.apiKey, apiSecret: strategy.apiSecret, exchange: Exchange.BINANCE,
      isTestnet: true, isRealAccount: false, portfolioId: null, source: 'strategy',
    });

    await service.onModuleInit();

    expect(binanceWs.subscribeUserDataStream).toHaveBeenCalledWith('s3', 'legacy-key', 'legacy-secret', true);
  });
});
