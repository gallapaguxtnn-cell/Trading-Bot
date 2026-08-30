jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { SymbolRulesService } from './symbol-rules.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { Exchange } from '../strategies/strategy.entity';

describe('SymbolRulesService', () => {
  let service: SymbolRulesService;
  let bybitClient: { getSymbolRules: jest.Mock };

  beforeEach(async () => {
    RateLimiterUtil.getInstance().clearCache();
    bybitClient = { getSymbolRules: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SymbolRulesService,
        { provide: BybitClientService, useValue: bybitClient },
      ],
    }).compile();

    service = module.get<SymbolRulesService>(SymbolRulesService);
  });

  it('busca as regras da Bybit e devolve qtyStep/priceTick/minQty/minNotional', async () => {
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });

    const rules = await service.getSymbolRules('SUIUSDT', true, Exchange.BYBIT);

    expect(rules).toEqual({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
  });

  it('usa cache de 1h: a segunda chamada para o mesmo simbolo nao bate na Bybit de novo', async () => {
    bybitClient.getSymbolRules.mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });

    await service.getSymbolRules('SUIUSDT_CACHE', true, Exchange.BYBIT);
    await service.getSymbolRules('SUIUSDT_CACHE', true, Exchange.BYBIT);

    expect(bybitClient.getSymbolRules).toHaveBeenCalledTimes(1);
  });

  it('devolve as regras padrao quando a Bybit falha, sem lancar excecao', async () => {
    bybitClient.getSymbolRules.mockRejectedValue(new Error('network error'));

    const rules = await service.getSymbolRules('BTCUSDT', true, Exchange.BYBIT);

    expect(rules).toEqual({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' });
  });

  it('busca as regras da Binance a partir do exchangeInfo (LOT_SIZE/PRICE_FILTER/MIN_NOTIONAL)', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
      data: {
        symbols: [
          {
            symbol: 'BTCUSDT',
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.10' },
              { filterType: 'MIN_NOTIONAL', notional: '5' },
            ],
          },
        ],
      },
    });

    const rules = await service.getSymbolRules('BTCUSDT', true, Exchange.BINANCE);

    expect(rules).toEqual({ qtyStep: '0.001', minQty: '0.001', priceTick: '0.10', minNotional: '5' });
  });

  it('devolve as regras padrao quando o simbolo nao existe na Binance', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({ data: { symbols: [] } });

    const rules = await service.getSymbolRules('DOESNOTEXIST', true, Exchange.BINANCE);

    expect(rules).toEqual({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' });
  });

  it('devolve as regras padrao quando a requisicao a Binance falha', async () => {
    (BinanceRequestUtil.get as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

    const rules = await service.getSymbolRules('ETHUSDT', true, Exchange.BINANCE);

    expect(rules).toEqual({ qtyStep: '0.001', priceTick: '0.01', minQty: '0.001', minNotional: '5' });
  });
});
