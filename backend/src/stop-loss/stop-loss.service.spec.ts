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

describe('StopLossService (FASE 4 -- PnL do SL lido da corretora)', () => {
  let service: StopLossService;
  let tradesRepository: { save: jest.Mock };
  let tradesService: { createExecution: jest.Mock };
  let symbolRulesService: { getSymbolRules: jest.Mock };
  let bybitClient: {
    getOrderInfo: jest.Mock;
    getOrderHistory: jest.Mock;
    getLastTradePrice: jest.Mock;
    getCurrentPrice: jest.Mock;
    createOrder: jest.Mock;
    getPositionIdx: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tradesRepository = { save: jest.fn() };
    tradesService = { createExecution: jest.fn() };
    symbolRulesService = { getSymbolRules: jest.fn() };
    bybitClient = {
      getOrderInfo: jest.fn(),
      getOrderHistory: jest.fn(),
      getLastTradePrice: jest.fn(),
      getCurrentPrice: jest.fn(),
      createOrder: jest.fn(),
      getPositionIdx: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StopLossService,
        { provide: getRepositoryToken(Trade), useValue: tradesRepository },
        { provide: TradesService, useValue: tradesService },
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

  it('caso real SUIUSDT: SL preenchido a 0.8015 (entry 0.796, 50 SUI, taxa 0.030) -> PnL exatamente -0.3050, lido da corretora', async () => {
    bybitClient.getOrderInfo.mockResolvedValue({
      orderId: 'sl-order-1',
      orderStatus: 'Filled',
      avgPrice: '0.8015',
      cumExecQty: '50',
      cumExecFee: '0.030',
      updatedTime: `${Date.now()}`,
    });

    const trade = {
      id: 'trade-1', symbol: 'SUIUSDT', side: 'SELL', quantity: 50, entryPrice: 0.796, pnl: null,
      stopLossOrderId: 'sl-order-1',
    } as unknown as Trade;

    await (service as any).markTradeAsClosed(trade, 'STOP_LOSS', Exchange.BYBIT, 'key', 'secret', false, 'sl-order-1');

    expect(bybitClient.getLastTradePrice).not.toHaveBeenCalled();

    const execArg = tradesService.createExecution.mock.calls[0][0];
    expect(execArg.tradeId).toBe('trade-1');
    expect(execArg.price).toBe(0.8015);
    expect(execArg.quantity).toBe(50);
    expect(execArg.fee).toBe(0.03);
    expect(execArg.pnl).toBeCloseTo(-0.305, 4);

    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.exitPrice).toBe(0.8015);
    expect(saved.pnl).toBeCloseTo(-0.305, 4);
  });

  it('sem orderId disponivel (ex.: stop nativo BYBIT_TRADING_STOP) -> cai no fallback local e loga erro, nunca silenciosamente', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    bybitClient.getLastTradePrice.mockResolvedValue(0.81);

    const trade = {
      id: 'trade-2', symbol: 'SUIUSDT', side: 'SELL', quantity: 50, entryPrice: 0.796, pnl: null,
      stopLossOrderId: 'BYBIT_TRADING_STOP',
    } as unknown as Trade;

    await (service as any).markTradeAsClosed(trade, 'STOP_LOSS', Exchange.BYBIT, 'key', 'secret', false, null);

    expect(errorSpy).toHaveBeenCalled();
    expect(bybitClient.getLastTradePrice).toHaveBeenCalled();
    const execArg = tradesService.createExecution.mock.calls[0][0];
    expect(execArg.fee).toBeNull();
  });

  it('falha ao consultar a ordem na corretora -> nao quebra o fechamento, usa fallback e loga erro', async () => {
    const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    bybitClient.getOrderInfo.mockResolvedValue(null);
    bybitClient.getOrderHistory.mockResolvedValue(null);
    bybitClient.getLastTradePrice.mockResolvedValue(0.8015);

    const trade = {
      id: 'trade-3', symbol: 'SUIUSDT', side: 'SELL', quantity: 50, entryPrice: 0.796, pnl: null,
      stopLossOrderId: 'sl-order-3',
    } as unknown as Trade;

    await (service as any).markTradeAsClosed(trade, 'STOP_LOSS', Exchange.BYBIT, 'key', 'secret', false, 'sl-order-3');

    expect(errorSpy).toHaveBeenCalled();
    expect(bybitClient.getLastTradePrice).toHaveBeenCalled();
    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.exitPrice).toBe(0.8015);
  });

  it('closePosition (gatilho manual por preco) Bybit: le o fill real da ordem a mercado e persiste a taxa separadamente', async () => {
    symbolRulesService.getSymbolRules.mockResolvedValue({ qtyStep: '1', priceTick: '0.0001', minQty: '1', minNotional: '5' });
    bybitClient.createOrder.mockResolvedValue({ orderId: 'close-order-1' });
    bybitClient.getOrderInfo.mockResolvedValue({
      orderId: 'close-order-1',
      orderStatus: 'Filled',
      avgPrice: '0.8015',
      cumExecQty: '50',
      cumExecFee: '0.030',
      updatedTime: `${Date.now()}`,
    });

    const trade = {
      id: 'trade-4', symbol: 'SUIUSDT', side: 'SELL', quantity: 50, entryPrice: 0.796, pnl: null,
      stopLossOrderId: 'sl-order-4',
    } as unknown as Trade;
    const strategy = { exchange: Exchange.BYBIT, isTestnet: false, hedgeMode: false };

    await (service as any).closePosition(trade, strategy, 0.8, 'STOP_LOSS', 'key', 'secret');

    const execArg = tradesService.createExecution.mock.calls[0][0];
    expect(execArg.price).toBe(0.8015);
    expect(execArg.quantity).toBe(50);
    expect(execArg.fee).toBe(0.03);
    expect(execArg.pnl).toBeCloseTo(-0.305, 4);

    const saved = tradesRepository.save.mock.calls[0][0];
    expect(saved.exitPrice).toBe(0.8015);
    expect(saved.pnl).toBeCloseTo(-0.305, 4);
  }, 10000);
});
