jest.mock('../utils/binance-request.util', () => ({
  BinanceRequestUtil: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StopLossService } from './stop-loss.service';
import { BinanceRequestUtil } from '../utils/binance-request.util';
import { Trade } from '../strategies/trade.entity';
import { TradesService } from '../trades/trades.service';
import { StrategiesService } from '../strategies/strategies.service';
import { ExchangeService } from '../exchange/exchange.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { BinanceWebSocketService } from '../binance-ws/binance-ws.service';
import { SymbolRulesService } from '../common/symbol-rules.service';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { Exchange } from '../strategies/strategy.entity';

describe('StopLossService (FASE 3 -- arredondamento via SymbolRulesService, nunca toFixed fixo)', () => {
  let service: StopLossService;
  let tradesRepository: { save: jest.Mock };
  let symbolRulesService: { getSymbolRules: jest.Mock };
  let bybitClient: { getPositionIdx: jest.Mock; createOrder: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    tradesRepository = { save: jest.fn() };
    symbolRulesService = { getSymbolRules: jest.fn() };
    bybitClient = {
      getPositionIdx: jest.fn().mockResolvedValue(0),
      createOrder: jest.fn().mockResolvedValue({ orderId: 'bybit-close-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StopLossService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: TradesService, useValue: {} },
        { provide: StrategiesService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SymbolRulesService, useValue: symbolRulesService },
        { provide: CredentialsResolverService, useValue: { resolveCredentials: jest.fn() } },
      ],
    }).compile();

    service = module.get<StopLossService>(StopLossService);
  });

  describe('recreateStopLoss (SUI: tick 0.0001, step 1)', () => {
    it('envia triggerPrice no tick real (0.7697) e quantidade inteira -- nunca 0.77 nem toFixed(3)', async () => {
      symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
      (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
        data: [{ symbol: 'SUIUSDT', positionSide: 'BOTH', positionAmt: '60' }],
      });
      (BinanceRequestUtil.post as jest.Mock).mockResolvedValueOnce({ data: { algoId: 111 } });

      const trade = {
        id: 'trade-1', symbol: 'SUIUSDT', side: 'SELL', quantity: 60, entryPrice: 0.7546, currentStopLoss: 0.7697,
      } as unknown as Trade;
      const strategy = { isTestnet: false, hedgeMode: false, stopLossPercentage: 2 };

      const recreated = await (service as any).recreateStopLoss(trade, strategy, Exchange.BINANCE, 'key', 'secret');

      expect(recreated).toBe(true);
      const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
      const params = new URLSearchParams(body);
      expect(params.get('triggerPrice')).toBe('0.7697');
      expect(params.get('quantity')).toBe('60');
    });

    it('aborta (nao envia a ordem) quando a quantidade normalizada arredonda para 0', async () => {
      symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.0001', minQty: '10', minNotional: '5' });
      (BinanceRequestUtil.get as jest.Mock).mockResolvedValueOnce({
        data: [{ symbol: 'SUIUSDT', positionSide: 'BOTH', positionAmt: '5' }],
      });

      const trade = {
        id: 'trade-1', symbol: 'SUIUSDT', side: 'SELL', quantity: 5, entryPrice: 0.7546, currentStopLoss: 0.7697,
      } as unknown as Trade;
      const strategy = { isTestnet: false, hedgeMode: false, stopLossPercentage: 2 };

      const recreated = await (service as any).recreateStopLoss(trade, strategy, Exchange.BINANCE, 'key', 'secret');

      expect(recreated).toBe(false);
      expect(BinanceRequestUtil.post).not.toHaveBeenCalled();
    });
  });

  describe('closePosition (fechamento a mercado pelo SL)', () => {
    it('Bybit: normaliza a quantidade pelo qtyStep real (nunca toFixed(3))', async () => {
      symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

      const trade = {
        id: 'trade-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 253, entryPrice: 60000, pnl: null,
      } as unknown as Trade;
      const strategy = { exchange: Exchange.BYBIT, isTestnet: true, hedgeMode: false };

      await (service as any).closePosition(trade, strategy, 58800, 'STOP_LOSS', 'key', 'secret');

      expect(bybitClient.createOrder).toHaveBeenCalledWith(
        'key', 'secret', true,
        expect.objectContaining({ qty: '250', orderType: 'Market', reduceOnly: true }),
      );
    });

    it('Bybit: aborta o fechamento (nao chama createOrder) quando a quantidade normalizada arredonda para 0', async () => {
      symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });

      const trade = {
        id: 'trade-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 5, entryPrice: 60000, pnl: null,
      } as unknown as Trade;
      const strategy = { exchange: Exchange.BYBIT, isTestnet: true, hedgeMode: false };

      await (service as any).closePosition(trade, strategy, 58800, 'STOP_LOSS', 'key', 'secret');

      expect(bybitClient.createOrder).not.toHaveBeenCalled();
    });

    it('Binance testnet: normaliza a quantidade pelo qtyStep real (nunca toFixed(3))', async () => {
      symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '10', priceTick: '0.10', minQty: '10', minNotional: '5' });
      (BinanceRequestUtil.post as jest.Mock).mockResolvedValueOnce({ data: {} });

      const trade = {
        id: 'trade-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 253, entryPrice: 60000, pnl: null,
      } as unknown as Trade;
      const strategy = { exchange: Exchange.BINANCE, isTestnet: true, hedgeMode: false };

      await (service as any).closePosition(trade, strategy, 58800, 'STOP_LOSS', 'key', 'secret');

      const body = (BinanceRequestUtil.post as jest.Mock).mock.calls[0][1] as string;
      const params = new URLSearchParams(body);
      expect(params.get('quantity')).toBe('250');
    });
  });
});

describe('StopLossService (FASE 2 -- CredentialsResolver)', () => {
  let service: StopLossService;
  let strategiesService: { findOne: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let bybitClient: { getPositions: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    strategiesService = { findOne: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };
    bybitClient = { getPositions: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StopLossService,
        { provide: getRepositoryToken(Trade), useValue: { save: jest.fn() } },
        { provide: TradesService, useValue: {} },
        { provide: StrategiesService, useValue: strategiesService },
        { provide: ExchangeService, useValue: {} },
        { provide: BybitClientService, useValue: bybitClient },
        { provide: BinanceWebSocketService, useValue: {} },
        { provide: SymbolRulesService, useValue: { getSymbolRules: jest.fn() } },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
      ],
    }).compile();

    service = module.get<StopLossService>(StopLossService);
  });

  it('checkStopLoss com portfolio: consulta a Bybit com as credenciais/exchange resolvidas do portfolio', async () => {
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      stopLossOrderId: 'BYBIT_TRADING_STOP',
    } as unknown as Trade;
    strategiesService.findOne.mockResolvedValue({
      id: 's1',
      exchange: Exchange.BINANCE,
      isTestnet: true,
      apiKey: 'legacy-key',
      apiSecret: 'legacy-secret',
      portfolioId: 'p1',
    });
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'portfolio-key',
      apiSecret: 'portfolio-secret',
      exchange: Exchange.BYBIT,
      isTestnet: false,
      isRealAccount: true,
      portfolioId: 'p1',
      source: 'portfolio',
    });

    await (service as any).checkStopLoss(trade);

    expect(bybitClient.getPositions).toHaveBeenCalledWith('portfolio-key', 'portfolio-secret', false, 'BTCUSDT');
  });
});
