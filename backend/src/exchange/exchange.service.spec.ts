import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExchangeService } from './exchange.service';
import { ProxyUtil } from '../utils/proxy.util';

describe('ExchangeService', () => {
  let service: ExchangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('ExchangeService (PLANO_FIX_ORDEM_OKX_NA_BINANCE -- FASE 4: CCXT respeita PROXY_EXCHANGES)', () => {
  let service: ExchangeService;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    ProxyUtil.initialize();
  });

  it('default (PROXY_EXCHANGES=binance): instancia CCXT da Bybit NAO recebe o agent do proxy Geonix (era o 407 do auditor)', async () => {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'user';
    process.env.GEONIX_PROXY_PASS = 'pass';
    delete process.env.PROXY_EXCHANGES;
    ProxyUtil.initialize();

    const bybit = await service.getExchange('bybit');

    expect(bybit.agent).toBeUndefined();
  });

  it('default (PROXY_EXCHANGES=binance): instancia CCXT da Binance recebe o agent do proxy Geonix (comportamento preservado)', async () => {
    process.env.GEONIX_PROXY_HOST = '1.2.3.4';
    process.env.GEONIX_PROXY_USER = 'user';
    process.env.GEONIX_PROXY_PASS = 'pass';
    delete process.env.PROXY_EXCHANGES;
    ProxyUtil.initialize();

    const binance = await service.getExchange('binance');

    expect(binance.agent).toBeDefined();
  });
});
