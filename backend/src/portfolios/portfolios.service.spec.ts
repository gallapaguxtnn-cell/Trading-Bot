import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { Portfolio, PortfolioMode } from './portfolio.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { EncryptionUtil } from '../utils/encryption.util';

function createQueryBuilderMock(result: any, isMany: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(isMany ? result : []),
    getOne: jest.fn().mockResolvedValue(!isMany ? result : null),
  };
}

describe('PortfoliosService', () => {
  let service: PortfoliosService;
  let portfoliosRepository: any;
  let strategiesRepository: { count: jest.Mock };
  let exchangeService: { getExchange: jest.Mock };
  let bybitClient: { getWalletBalance: jest.Mock };
  let exchangeFactory: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    portfoliosRepository = {
      createQueryBuilder: jest.fn(),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (entity: any) => ({
        id: 'portfolio-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...entity,
      })),
      update: jest.fn(),
      delete: jest.fn(),
    };
    strategiesRepository = { count: jest.fn().mockResolvedValue(0) };
    exchangeService = { getExchange: jest.fn() };
    bybitClient = { getWalletBalance: jest.fn() };
    exchangeFactory = { get: jest.fn().mockReturnValue(bybitClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: getRepositoryToken(Portfolio), useValue: portfoliosRepository },
        { provide: getRepositoryToken(Strategy), useValue: strategiesRepository },
        { provide: ExchangeService, useValue: exchangeService },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
      ],
    }).compile();

    service = module.get<PortfoliosService>(PortfoliosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllPublic', () => {
    it('seleciona apenas colunas nao sensiveis + apiKey (nunca apiSecret) e mascara apiKey', async () => {
      const encryptedKey = await EncryptionUtil.encrypt('asdadreal-api-key-12345');
      const qb = createQueryBuilderMock(
        [
          {
            id: 'p1',
            name: 'teste',
            exchange: Exchange.BYBIT,
            mode: PortfolioMode.DEMO,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            apiKey: encryptedKey,
          },
        ],
        true,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllPublic();

      expect(qb.addSelect).toHaveBeenCalledWith('portfolio.apiKey');
      expect(qb.addSelect).not.toHaveBeenCalledWith(expect.stringContaining('apiSecret'));
      expect(result[0].apiKeyMasked).toBe('asdad••••••');
      expect(result[0]).not.toHaveProperty('apiSecret');
      expect(Object.keys(result[0]).sort()).toEqual(
        ['apiKeyMasked', 'bybitSiteId', 'region', 'createdAt', 'exchange', 'id', 'isActive', 'mode', 'name', 'updatedAt'].sort(),
      );
    });

    it('portfolio sem apiKey retorna mascara vazia em vez de quebrar', async () => {
      const qb = createQueryBuilderMock(
        [
          {
            id: 'p2',
            name: 'sem chave',
            exchange: Exchange.BINANCE,
            mode: PortfolioMode.REAL,
            isActive: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            apiKey: null,
          },
        ],
        true,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllPublic();

      expect(result[0].apiKeyMasked).toBe('');
    });
  });

  describe('create', () => {
    it('criptografa apiKey/apiSecret antes de salvar e a resposta publica nunca expoe apiSecret', async () => {
      const qb = createQueryBuilderMock(
        {
          id: 'portfolio-1',
          name: 'teste',
          exchange: Exchange.BYBIT,
          mode: PortfolioMode.DEMO,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          apiKey: 'encrypted-key',
        },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.create({
        name: 'teste',
        exchange: Exchange.BYBIT,
        mode: PortfolioMode.DEMO,
        apiKey: 'plain-key',
        apiSecret: 'plain-secret',
      } as Partial<Portfolio>);

      const savedArg = portfoliosRepository.save.mock.calls[0][0];
      expect(savedArg.apiKey).not.toBe('plain-key');
      expect(savedArg.apiSecret).not.toBe('plain-secret');
      expect(result).not.toHaveProperty('apiSecret');
    });

    it('OKX sem passphrase -> erro de validacao claro, nunca chega a salvar', async () => {
      await expect(
        service.create({
          name: 'teste okx',
          exchange: Exchange.OKX,
          mode: PortfolioMode.DEMO,
          apiKey: 'plain-key',
          apiSecret: 'plain-secret',
        } as Partial<Portfolio>),
      ).rejects.toThrow('Passphrase');
      expect(portfoliosRepository.save).not.toHaveBeenCalled();
    });

    it('OKX com passphrase: criptografa apiPassphrase antes de salvar junto com apiKey/apiSecret', async () => {
      const qb = createQueryBuilderMock(
        { id: 'portfolio-2', name: 'okx', exchange: Exchange.OKX, mode: PortfolioMode.DEMO, isActive: true, createdAt: new Date(), updatedAt: new Date() },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await service.create({
        name: 'okx',
        exchange: Exchange.OKX,
        mode: PortfolioMode.DEMO,
        apiKey: 'plain-key',
        apiSecret: 'plain-secret',
        apiPassphrase: 'plain-pass',
      } as Partial<Portfolio>);

      const savedArg = portfoliosRepository.save.mock.calls[0][0];
      expect(savedArg.apiPassphrase).not.toBe('plain-pass');
      expect(savedArg.apiPassphrase).toBeDefined();
    });

    describe('FASE 4 -- trava de OKX REAL ate a flag de release', () => {
      const originalOkxEnabled = process.env.OKX_ENABLED;

      afterEach(() => {
        if (originalOkxEnabled === undefined) delete process.env.OKX_ENABLED;
        else process.env.OKX_ENABLED = originalOkxEnabled;
      });

      it('OKX REAL sem OKX_ENABLED=true -> erro de validacao claro, nunca chega a salvar', async () => {
        delete process.env.OKX_ENABLED;

        await expect(
          service.create({
            name: 'okx real',
            exchange: Exchange.OKX,
            mode: PortfolioMode.REAL,
            apiKey: 'plain-key',
            apiSecret: 'plain-secret',
            apiPassphrase: 'plain-pass',
          } as Partial<Portfolio>),
        ).rejects.toThrow('OKX_ENABLED');
        expect(portfoliosRepository.save).not.toHaveBeenCalled();
      });

      it('OKX DEMO sem OKX_ENABLED=true -> permitido normalmente (a trava e so para REAL)', async () => {
        delete process.env.OKX_ENABLED;
        const qb = createQueryBuilderMock(
          { id: 'portfolio-3', name: 'okx demo', exchange: Exchange.OKX, mode: PortfolioMode.DEMO, isActive: true, createdAt: new Date(), updatedAt: new Date() },
          false,
        );
        portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

        await expect(
          service.create({
            name: 'okx demo',
            exchange: Exchange.OKX,
            mode: PortfolioMode.DEMO,
            apiKey: 'plain-key',
            apiSecret: 'plain-secret',
            apiPassphrase: 'plain-pass',
          } as Partial<Portfolio>),
        ).resolves.not.toBeNull();
      });

      it('OKX REAL com OKX_ENABLED=true -> permitido', async () => {
        process.env.OKX_ENABLED = 'true';
        const qb = createQueryBuilderMock(
          { id: 'portfolio-4', name: 'okx real ok', exchange: Exchange.OKX, mode: PortfolioMode.REAL, isActive: true, createdAt: new Date(), updatedAt: new Date() },
          false,
        );
        portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

        await expect(
          service.create({
            name: 'okx real ok',
            exchange: Exchange.OKX,
            mode: PortfolioMode.REAL,
            apiKey: 'plain-key',
            apiSecret: 'plain-secret',
            apiPassphrase: 'plain-pass',
          } as Partial<Portfolio>),
        ).resolves.not.toBeNull();
      });

      it('trocar um portfolio OKX existente de DEMO para REAL sem OKX_ENABLED=true -> erro, nao atualiza', async () => {
        delete process.env.OKX_ENABLED;
        const qb = createQueryBuilderMock(
          { id: 'p1', exchange: Exchange.OKX, mode: PortfolioMode.DEMO, apiPassphrase: 'existing-pass' },
          false,
        );
        portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

        await expect(
          service.update('p1', { mode: PortfolioMode.REAL } as Partial<Portfolio>),
        ).rejects.toThrow('OKX_ENABLED');
        expect(portfoliosRepository.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('credenciais em branco preservam as existentes (nao sobrescreve)', async () => {
      const qb = createQueryBuilderMock({ id: 'p1', name: 'teste2', apiKey: 'unchanged' }, false);
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await service.update('p1', { name: 'teste2', apiKey: '', apiSecret: '' } as Partial<Portfolio>);

      const updateArg = portfoliosRepository.update.mock.calls[0][1];
      expect(updateArg).not.toHaveProperty('apiKey');
      expect(updateArg).not.toHaveProperty('apiSecret');
      expect(updateArg.name).toBe('teste2');
    });

    it('substitui apiKey quando um novo valor e informado, sempre criptografado', async () => {
      const qb = createQueryBuilderMock({ id: 'p1' }, false);
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await service.update('p1', { apiKey: 'new-key' } as Partial<Portfolio>);

      const updateArg = portfoliosRepository.update.mock.calls[0][1];
      expect(updateArg.apiKey).not.toBe('new-key');
    });

    it('trocar para OKX sem passphrase (nem nova, nem ja existente) -> erro de validacao, nao atualiza', async () => {
      const qb = createQueryBuilderMock({ id: 'p1', apiPassphrase: null }, false);
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.update('p1', { exchange: Exchange.OKX } as Partial<Portfolio>),
      ).rejects.toThrow('Passphrase');
      expect(portfoliosRepository.update).not.toHaveBeenCalled();
    });

    it('substitui apiPassphrase quando um novo valor e informado, sempre criptografado', async () => {
      const qb = createQueryBuilderMock({ id: 'p1' }, false);
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await service.update('p1', { exchange: Exchange.OKX, apiPassphrase: 'new-pass' } as Partial<Portfolio>);

      const updateArg = portfoliosRepository.update.mock.calls[0][1];
      expect(updateArg.apiPassphrase).not.toBe('new-pass');
      expect(updateArg.apiPassphrase).toBeDefined();
    });
  });

  describe('remove', () => {
    it('recusa com 409 quando ha estrategia vinculada e nao apaga', async () => {
      strategiesRepository.count.mockResolvedValue(2);

      await expect(service.remove('p1')).rejects.toThrow(ConflictException);
      expect(portfoliosRepository.delete).not.toHaveBeenCalled();
    });

    it('remove quando nao ha estrategia vinculada', async () => {
      strategiesRepository.count.mockResolvedValue(0);

      const result = await service.remove('p1');

      expect(result).toEqual({ success: true });
      expect(portfoliosRepository.delete).toHaveBeenCalledWith('p1');
    });
  });

  describe('testConnection', () => {
    it('lanca NotFoundException quando o portfolio nao existe', async () => {
      const qb = createQueryBuilderMock(null, false);
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.testConnection('missing')).rejects.toThrow(NotFoundException);
    });

    it('retorna erro sem lancar quando o portfolio nao tem credenciais', async () => {
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BYBIT, mode: PortfolioMode.DEMO, apiKey: null, apiSecret: null },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.testConnection('p1');

      expect(result.success).toBe(false);
    });

    it('bybit: decripta as credenciais e usa isTestnet=true para modo DEMO', async () => {
      const encKey = await EncryptionUtil.encrypt('key123');
      const encSecret = await EncryptionUtil.encrypt('secret123');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BYBIT, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      bybitClient.getWalletBalance.mockResolvedValue(1234.5);

      const result = await service.testConnection('p1');

      expect(exchangeFactory.get).toHaveBeenCalledWith(Exchange.BYBIT);
      expect(bybitClient.getWalletBalance).toHaveBeenCalledWith({
        credentials: { apiKey: 'key123', apiSecret: 'secret123' },
        mode: 'DEMO',
        region: null,
      });
      expect(result).toEqual({ success: true, balance: 1234.5 });
    });

    it('bybit: repassa o bybitSiteId do portfolio (conta internacional BRA_BTL) para o header x-site-id', async () => {
      const encKey = await EncryptionUtil.encrypt('key123');
      const encSecret = await EncryptionUtil.encrypt('secret123');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BYBIT, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret, bybitSiteId: 'BRA_BTL' },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      bybitClient.getWalletBalance.mockResolvedValue(500);

      await service.testConnection('p1');

      expect(bybitClient.getWalletBalance).toHaveBeenCalledWith({
        credentials: { apiKey: 'key123', apiSecret: 'secret123' },
        mode: 'DEMO',
        region: 'BRA_BTL',
      });
    });

    it('bybit: region (FASE 3) tem precedencia sobre bybitSiteId legado quando ambos estao preenchidos', async () => {
      const encKey = await EncryptionUtil.encrypt('key123');
      const encSecret = await EncryptionUtil.encrypt('secret123');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BYBIT, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret, bybitSiteId: 'ARG_BTL', region: 'BRA_BTL' },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      bybitClient.getWalletBalance.mockResolvedValue(500);

      await service.testConnection('p1');

      expect(bybitClient.getWalletBalance).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'BRA_BTL' }),
      );
    });

    it('bybit: sem region nem bybitSiteId -> region null, comportamento atual identico', async () => {
      const encKey = await EncryptionUtil.encrypt('key123');
      const encSecret = await EncryptionUtil.encrypt('secret123');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BYBIT, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      bybitClient.getWalletBalance.mockResolvedValue(500);

      await service.testConnection('p1');

      expect(bybitClient.getWalletBalance).toHaveBeenCalledWith(
        expect.objectContaining({ region: null }),
      );
    });

    it('binance: usa isTestnet=false para modo REAL e le o saldo USDT via ccxt', async () => {
      const encKey = await EncryptionUtil.encrypt('bkey');
      const encSecret = await EncryptionUtil.encrypt('bsecret');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BINANCE, mode: PortfolioMode.REAL, apiKey: encKey, apiSecret: encSecret },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      const fetchBalance = jest.fn().mockResolvedValue({ total: { USDT: 500 } });
      exchangeService.getExchange.mockResolvedValue({ fetchBalance });

      const result = await service.testConnection('p1');

      expect(exchangeService.getExchange).toHaveBeenCalledWith('binance', 'bkey', 'bsecret', false);
      expect(result).toEqual({ success: true, balance: 500 });
    });

    it('BingX ainda sem client: retorna mensagem de nao suportado em vez de lancar', async () => {
      const encKey = await EncryptionUtil.encrypt('k');
      const encSecret = await EncryptionUtil.encrypt('s');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.BINGX, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.testConnection('p1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('bingx');
    });

    it('OKX (FASE 7): sem passphrase gravada -- retorna mensagem clara em vez de tentar conectar', async () => {
      const encKey = await EncryptionUtil.encrypt('k');
      const encSecret = await EncryptionUtil.encrypt('s');
      const qb = createQueryBuilderMock(
        { id: 'p1', exchange: Exchange.OKX, mode: PortfolioMode.DEMO, apiKey: encKey, apiSecret: encSecret, apiPassphrase: null },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.testConnection('p1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Passphrase');
      expect(exchangeFactory.get).not.toHaveBeenCalledWith(Exchange.OKX);
    });

    it('OKX (FASE 7): com passphrase, decripta as 3 credenciais e consulta o saldo via OkxClientService', async () => {
      const encKey = await EncryptionUtil.encrypt('okx-key');
      const encSecret = await EncryptionUtil.encrypt('okx-secret');
      const encPassphrase = await EncryptionUtil.encrypt('okx-pass');
      const qb = createQueryBuilderMock(
        {
          id: 'p1', exchange: Exchange.OKX, mode: PortfolioMode.DEMO,
          apiKey: encKey, apiSecret: encSecret, apiPassphrase: encPassphrase, region: 'EL_SALVADOR',
        },
        false,
      );
      portfoliosRepository.createQueryBuilder.mockReturnValue(qb);
      const okxClient = { getWalletBalance: jest.fn().mockResolvedValue(1000) };
      exchangeFactory.get.mockImplementation((exchange: Exchange) => (exchange === Exchange.OKX ? okxClient : bybitClient));

      const result = await service.testConnection('p1');

      expect(okxClient.getWalletBalance).toHaveBeenCalledWith({
        credentials: { apiKey: 'okx-key', apiSecret: 'okx-secret', passphrase: 'okx-pass' },
        mode: 'DEMO',
        region: 'EL_SALVADOR',
      });
      expect(result).toEqual({ success: true, balance: 1000 });
    });
  });
});
