jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';

describe('StrategiesController', () => {
  let controller: StrategiesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategiesController],
      providers: [
        { provide: StrategiesService, useValue: {} },
        { provide: CredentialsResolverService, useValue: { resolveCredentials: jest.fn() } },
      ],
    }).compile();

    controller = module.get<StrategiesController>(StrategiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
