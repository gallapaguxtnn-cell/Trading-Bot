jest.mock('./utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BinanceWebSocketService } from './binance-ws/binance-ws.service';
import { Strategy } from './strategies/strategy.entity';
import { CredentialsResolverService } from './common/credentials-resolver.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: CredentialsResolverService, useValue: { resolveCredentials: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('GET /config (FASE 8 -- PLANO_INTEGRACAO_OKX)', () => {
    const originalOkxEnabled = process.env.OKX_ENABLED;

    afterEach(() => {
      if (originalOkxEnabled === undefined) delete process.env.OKX_ENABLED;
      else process.env.OKX_ENABLED = originalOkxEnabled;
    });

    it('OKX_ENABLED nao setada -> okxEnabled false (padrao seguro)', () => {
      delete process.env.OKX_ENABLED;
      expect(appController.getPublicConfig()).toEqual({ okxEnabled: false });
    });

    it('OKX_ENABLED="true" -> okxEnabled true', () => {
      process.env.OKX_ENABLED = 'true';
      expect(appController.getPublicConfig()).toEqual({ okxEnabled: true });
    });

    it('OKX_ENABLED com qualquer outro valor (ex.: "1") -> okxEnabled false, so a string exata "true" liga', () => {
      process.env.OKX_ENABLED = '1';
      expect(appController.getPublicConfig()).toEqual({ okxEnabled: false });
    });
  });
});
