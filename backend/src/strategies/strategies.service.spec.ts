jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StrategiesService } from './strategies.service';
import { Strategy } from './strategy.entity';
import { Trade } from './trade.entity';
import { BybitClientService } from '../exchange/bybit-client.service';

describe('StrategiesService', () => {
  let service: StrategiesService;
  let strategiesRepository: { findOne: jest.Mock; update: jest.Mock; findOneBy: jest.Mock };

  beforeEach(async () => {
    strategiesRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
      findOneBy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategiesService,
        { provide: getRepositoryToken(Strategy), useValue: strategiesRepository },
        { provide: getRepositoryToken(Trade), useValue: {} },
        { provide: BybitClientService, useValue: {} },
      ],
    }).compile();

    service = module.get<StrategiesService>(StrategiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findOnePublic requests enableTakeProfit1/2/3 in the select list', async () => {
    strategiesRepository.findOne.mockResolvedValue(null);

    await service.findOnePublic('strategy-1');

    const options = strategiesRepository.findOne.mock.calls[0][0];
    expect(options.select).toEqual(
      expect.arrayContaining(['enableTakeProfit1', 'enableTakeProfit2', 'enableTakeProfit3']),
    );
  });

  it('update persists a disabled TP2 and the read-back reflects it (round-trip)', async () => {
    strategiesRepository.update.mockResolvedValue(undefined);
    strategiesRepository.findOneBy.mockResolvedValue({
      id: 'strategy-1',
      enableTakeProfit1: true,
      enableTakeProfit2: false,
      enableTakeProfit3: true,
      takeProfitPercentage2: null,
    } as unknown as Strategy);

    const result = await service.update('strategy-1', {
      enableTakeProfit2: false,
      takeProfitPercentage2: null as unknown as number,
    });

    expect(strategiesRepository.update).toHaveBeenCalledWith(
      'strategy-1',
      expect.objectContaining({ enableTakeProfit2: false, takeProfitPercentage2: null }),
    );
    expect(result?.enableTakeProfit2).toBe(false);

    strategiesRepository.findOne.mockResolvedValue(result);
    const reloaded = await service.findOnePublic('strategy-1');
    expect(reloaded?.enableTakeProfit2).toBe(false);
  });
});
