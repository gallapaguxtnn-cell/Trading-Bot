jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';

describe('StrategiesController', () => {
  let controller: StrategiesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategiesController],
      providers: [
        { provide: StrategiesService, useValue: {} },
      ],
    }).compile();

    controller = module.get<StrategiesController>(StrategiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
