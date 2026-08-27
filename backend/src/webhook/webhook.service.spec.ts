jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WebhookService } from './webhook.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { StrategiesService } from '../strategies/strategies.service';
import { TradesService } from '../trades/trades.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SignalLogService } from './signal-log.service';

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: TradesService, useValue: {} },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SignalLogService, useValue: {} },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calculateTakeProfitPrice mantem a formula (BUY soma %, SELL subtrai %) -- nenhuma FASE deste plano altera isso', () => {
    const calculateTakeProfitPrice = (service as any).calculateTakeProfitPrice.bind(service);

    expect(calculateTakeProfitPrice('BUY', 100, 2)).toBeCloseTo(102, 8);
    expect(calculateTakeProfitPrice('SELL', 100, 2)).toBeCloseTo(98, 8);
  });

  it('calculateStopLossPrice mantem a formula (BUY subtrai %, SELL soma %) -- nenhuma FASE deste plano altera isso', () => {
    const calculateStopLossPrice = (service as any).calculateStopLossPrice.bind(service);

    expect(calculateStopLossPrice('BUY', 100, 2)).toBeCloseTo(98, 8);
    expect(calculateStopLossPrice('SELL', 100, 2)).toBeCloseTo(102, 8);
  });

  it('normalizeQuantity arredonda para baixo no qtyStep e nunca devolve valor negativo', () => {
    const normalizeQuantity = (service as any).normalizeQuantity.bind(service);

    expect(normalizeQuantity(1789.98, '1', '1')).toBe('1789');
    expect(normalizeQuantity(0.0007, '0.001', '0.001')).toBe('0');
  });
});
