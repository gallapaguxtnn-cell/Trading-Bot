jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('axios', () => ({
  get: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import axios from 'axios';
import { AdminService } from './admin.service';
import { RateLimiterUtil } from '../utils/rate-limiter.util';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { SignalLog } from '../webhook/signal-log.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { AuditLog, AuditCategory } from '../auditor/audit-log.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';

function makeTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trade-1',
    status: 'CLOSED',
    pnl: 10,
    portfolioId: null,
    strategyId: 's1',
    symbol: 'BTCUSDT',
    exchangeOrderId: null,
    timestamp: new Date('2026-08-19T05:00:00Z'),
    ...overrides,
  };
}

function makeStrategy(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    exchange: Exchange.BYBIT,
    isTestnet: true,
    apiKey: 'enc-key',
    apiSecret: 'enc-secret',
    portfolioId: null,
    ...overrides,
  };
}

describe('AdminService.resetTrades', () => {
  let service: AdminService;
  let tradeRepository: { find: jest.Mock; delete: jest.Mock };
  let executionRepository: { count: jest.Mock; find: jest.Mock; delete: jest.Mock };
  let signalLogRepository: { count: jest.Mock; find: jest.Mock; delete: jest.Mock; clear: jest.Mock };
  let strategyRepository: { find: jest.Mock };
  let auditRepository: { create: jest.Mock; save: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let bybitClient: { getOrderInfo: jest.Mock; getOrderHistory: jest.Mock; cancelOrder: jest.Mock };
  let exchangeFactory: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    tradeRepository = { find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
    executionRepository = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]), delete: jest.fn() };
    signalLogRepository = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]), delete: jest.fn(), clear: jest.fn() };
    strategyRepository = { find: jest.fn().mockResolvedValue([]) };
    auditRepository = { create: jest.fn((x) => x), save: jest.fn() };
    credentialsResolver = { resolveCredentials: jest.fn() };
    bybitClient = {
      getOrderInfo: jest.fn().mockResolvedValue(null),
      getOrderHistory: jest.fn().mockResolvedValue(null),
      cancelOrder: jest.fn().mockResolvedValue(true),
    };
    exchangeFactory = { get: jest.fn().mockReturnValue(bybitClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: getRepositoryToken(TradeExecution), useValue: executionRepository },
        { provide: getRepositoryToken(SignalLog), useValue: signalLogRepository },
        { provide: getRepositoryToken(Strategy), useValue: strategyRepository },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepository },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('dryRun por padrao (sem passar dryRun): lista contagens sem apagar nada', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'CLOSED', pnl: 10 }),
      makeTrade({ id: 't2', status: 'ERROR', pnl: null }),
    ]);

    const result = await service.resetTrades({});

    expect(result.dryRun).toBe(true);
    expect((result as any).countsByStatus).toEqual({ CLOSED: 1, ERROR: 1 });
    expect((result as any).accumulatedPnl).toBe(10);
    expect((result as any).tradesCount).toBe(2);
    expect(tradeRepository.delete).not.toHaveBeenCalled();
  });

  it('dryRun explicito=true tambem so lista, mesmo com trade OPEN presente', async () => {
    tradeRepository.find.mockResolvedValue([makeTrade({ status: 'OPEN' })]);

    const result = await service.resetTrades({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect((result as any).openTradesBlocking).toBe(1);
    expect(tradeRepository.delete).not.toHaveBeenCalled();
  });

  it('execucao real sem confirm "RESET" -- lanca BadRequestException e nao apaga', async () => {
    tradeRepository.find.mockResolvedValue([]);

    await expect(service.resetTrades({ dryRun: false })).rejects.toThrow(BadRequestException);
    expect(tradeRepository.delete).not.toHaveBeenCalled();
  });

  it('execucao real com trade OPEN -- RECUSA mesmo com confirm correto, nao apaga nada', async () => {
    tradeRepository.find.mockResolvedValue([makeTrade({ id: 'open-1', status: 'OPEN' })]);

    await expect(service.resetTrades({ dryRun: false, confirm: 'RESET' })).rejects.toThrow(ConflictException);
    expect(tradeRepository.delete).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('execucao real valida (sem OPEN, confirm correto): exporta backup, apaga trades/execucoes/signal_logs e registra AuditLog', async () => {
    tradeRepository.find.mockResolvedValue([makeTrade({ id: 't1', status: 'CLOSED' })]);
    executionRepository.count.mockResolvedValue(2);
    executionRepository.find.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    signalLogRepository.count.mockResolvedValue(3);
    signalLogRepository.find.mockResolvedValue([{ id: 'sl1' }, { id: 'sl2' }, { id: 'sl3' }]);

    const result = await service.resetTrades({ dryRun: false, confirm: 'RESET', executedBy: 'lucas' });

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(executionRepository.delete).toHaveBeenCalled();
    expect(signalLogRepository.clear).toHaveBeenCalled();
    expect(tradeRepository.delete).toHaveBeenCalled();
    expect(auditRepository.save).toHaveBeenCalled();
    expect(auditRepository.create.mock.calls[0][0].category).toBe(AuditCategory.ADMIN_RESET);
    expect(result).toMatchObject({ dryRun: false, success: true, deletedTrades: 1, deletedExecutions: 2, deletedSignalLogs: 3 });
  });

  it('com portfolioId: filtra trades/signal_logs pelo portfolio e preserva os de outros portfolios', async () => {
    tradeRepository.find.mockResolvedValue([makeTrade({ id: 't1', status: 'CLOSED', portfolioId: 'p1' })]);
    strategyRepository.find.mockResolvedValue([{ id: 's1' }]);
    signalLogRepository.find.mockResolvedValue([]);

    await service.resetTrades({ dryRun: false, confirm: 'RESET', portfolioId: 'p1' });

    expect(tradeRepository.find).toHaveBeenCalledWith({ where: { portfolioId: 'p1' } });
    expect(signalLogRepository.delete).toHaveBeenCalledWith({ strategyId: expect.anything() });
    expect(signalLogRepository.clear).not.toHaveBeenCalled();
  });

  it('dryRun inclui liveOrders quando ha ordem exchangeOrderId ainda ativa na corretora', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'ERROR', exchangeOrderId: 'order-123' }),
    ]);
    strategyRepository.find.mockResolvedValue([makeStrategy()]);
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });
    bybitClient.getOrderInfo.mockResolvedValue({ orderId: 'order-123', orderStatus: 'New' });

    const result = await service.resetTrades({ dryRun: true });

    expect((result as any).liveOrders).toEqual([
      { tradeId: 't1', symbol: 'BTCUSDT', orderId: 'order-123', status: 'New', exchange: Exchange.BYBIT },
    ]);
  });

  it('OKX (FASE 6): usa o vocabulario capitalizado (New/PartiallyFilled), nao o vocabulario maiusculo da Binance', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'ERROR', exchangeOrderId: 'order-123' }),
    ]);
    strategyRepository.find.mockResolvedValue([makeStrategy()]);
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      exchange: Exchange.OKX,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });
    bybitClient.getOrderInfo.mockResolvedValue({ orderId: 'order-123', orderStatus: 'New' });

    const result = await service.resetTrades({ dryRun: true });

    expect((result as any).liveOrders).toEqual([
      { tradeId: 't1', symbol: 'BTCUSDT', orderId: 'order-123', status: 'New', exchange: Exchange.OKX },
    ]);
  });

  it('reset real com ordem New na corretora -- RECUSA mesmo com confirm correto, nao apaga nada', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'ERROR', exchangeOrderId: 'order-123' }),
    ]);
    strategyRepository.find.mockResolvedValue([makeStrategy()]);
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });
    bybitClient.getOrderInfo.mockResolvedValue({ orderId: 'order-123', orderStatus: 'New' });

    await expect(service.resetTrades({ dryRun: false, confirm: 'RESET' })).rejects.toThrow(ConflictException);
    expect(tradeRepository.delete).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(bybitClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('reset real com cancelOrphanOrders=true: cancela a ordem viva, registra e prossegue com o apagamento', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'ERROR', exchangeOrderId: 'order-123' }),
    ]);
    strategyRepository.find.mockResolvedValue([makeStrategy()]);
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: 'BRA_BTL',
      source: 'strategy',
    });
    bybitClient.getOrderInfo.mockResolvedValue({ orderId: 'order-123', orderStatus: 'New' });

    const result = await service.resetTrades({ dryRun: false, confirm: 'RESET', cancelOrphanOrders: true });

    expect(bybitClient.cancelOrder).toHaveBeenCalledWith(
      { credentials: { apiKey: 'plain-key', apiSecret: 'plain-secret', passphrase: null }, mode: 'DEMO', region: 'BRA_BTL' },
      'BTCUSDT',
      'order-123',
    );
    expect(tradeRepository.delete).toHaveBeenCalled();
    expect((result as any).cancelledOrphanOrders).toEqual([
      { tradeId: 't1', symbol: 'BTCUSDT', orderId: 'order-123', status: 'New', exchange: Exchange.BYBIT },
    ]);
  });

  it('ordem ja resolvida na corretora (nao New/PartiallyFilled/Untriggered): nao bloqueia o reset', async () => {
    tradeRepository.find.mockResolvedValue([
      makeTrade({ id: 't1', status: 'CLOSED', exchangeOrderId: 'order-123' }),
    ]);
    strategyRepository.find.mockResolvedValue([makeStrategy()]);
    credentialsResolver.resolveCredentials.mockResolvedValue({
      apiKey: 'plain-key',
      apiSecret: 'plain-secret',
      exchange: Exchange.BYBIT,
      isTestnet: true,
      isRealAccount: false,
      portfolioId: null,
      siteId: null,
      source: 'strategy',
    });
    bybitClient.getOrderInfo.mockResolvedValue(null);
    bybitClient.getOrderHistory.mockResolvedValue({ orderId: 'order-123', orderStatus: 'Filled' });

    const result = await service.resetTrades({ dryRun: false, confirm: 'RESET' });

    expect(result).toMatchObject({ success: true, deletedTrades: 1 });
    expect(bybitClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('sem trades: reset real nao lanca e reporta zero remocoes', async () => {
    tradeRepository.find.mockResolvedValue([]);

    const result = await service.resetTrades({ dryRun: false, confirm: 'RESET' });

    expect(result).toMatchObject({ success: true, deletedTrades: 0, deletedExecutions: 0 });
    expect(tradeRepository.delete).not.toHaveBeenCalled();
  });
});

describe('AdminService.getEgressIp (PLANO_FIX_PROXY_407_OKX -- FASE 3)', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    RateLimiterUtil.getInstance().clearCache();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Trade), useValue: {} },
        { provide: getRepositoryToken(TradeExecution), useValue: {} },
        { provide: getRepositoryToken(SignalLog), useValue: {} },
        { provide: getRepositoryToken(Strategy), useValue: {} },
        { provide: getRepositoryToken(AuditLog), useValue: {} },
        { provide: CredentialsResolverService, useValue: {} },
        { provide: ExchangeClientFactory, useValue: {} },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  afterEach(() => {
    RateLimiterUtil.getInstance().clearCache();
  });

  it('devolve o IP do primeiro provedor (JSON, formato ipify) e cacheia', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { ip: '203.0.113.42' } });

    const result = await service.getEgressIp();

    expect(result).toEqual({ ip: '203.0.113.42', cached: false });
    expect(axios.get).toHaveBeenCalledWith('https://api.ipify.org?format=json', expect.objectContaining({ timeout: 5000 }));
  });

  it('chamada seguinte dentro de 10 minutos usa o cache, sem nova requisicao HTTP', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { ip: '203.0.113.42' } });
    await service.getEgressIp();

    const result = await service.getEgressIp();

    expect(result).toEqual({ ip: '203.0.113.42', cached: true });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('primeiro provedor falha -> cai para o segundo (texto puro, formato ifconfig.me)', async () => {
    (axios.get as jest.Mock)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: '203.0.113.99\n' });

    const result = await service.getEgressIp();

    expect(result).toEqual({ ip: '203.0.113.99', cached: false });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('todos os provedores falham -> erro claro, nunca IP vazio', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(service.getEgressIp()).rejects.toThrow(BadRequestException);
  });

  it('nao usa proxy: chama axios.get diretamente, sem passar por ProxyUtil/BinanceRequestUtil/OkxRequestUtil', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ data: { ip: '203.0.113.42' } });

    await service.getEgressIp();

    const callConfig = (axios.get as jest.Mock).mock.calls[0][1];
    expect(callConfig).not.toHaveProperty('httpsAgent');
    expect(callConfig).not.toHaveProperty('proxy');
  });
});

describe('AdminService.reconcileGhostTrades (PLANO_DEFINITIVO_CORRETORAS -- FASE 1)', () => {
  let service: AdminService;
  let tradeRepository: { find: jest.Mock; update: jest.Mock };
  let strategyRepository: { find: jest.Mock };
  let credentialsResolver: { resolveCredentials: jest.Mock };
  let exchangeClient: { getPositions: jest.Mock };
  let exchangeFactory: { get: jest.Mock };

  function makeOpenTrade(overrides: Record<string, unknown> = {}) {
    return {
      id: 'trade-1',
      status: 'OPEN',
      strategyId: 's1',
      symbol: 'DOGEUSDT',
      side: 'SELL',
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    tradeRepository = { find: jest.fn().mockResolvedValue([]), update: jest.fn() };
    strategyRepository = { find: jest.fn().mockResolvedValue([{ id: 's1', exchange: Exchange.BYBIT, isTestnet: false, apiKey: 'k', apiSecret: 's' }]) };
    credentialsResolver = {
      resolveCredentials: jest.fn().mockResolvedValue({
        apiKey: 'k', apiSecret: 's', exchange: Exchange.BYBIT, isTestnet: false, isRealAccount: true, portfolioId: null, siteId: null, source: 'strategy',
      }),
    };
    exchangeClient = { getPositions: jest.fn().mockResolvedValue([]) };
    exchangeFactory = { get: jest.fn().mockReturnValue(exchangeClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: getRepositoryToken(TradeExecution), useValue: {} },
        { provide: getRepositoryToken(SignalLog), useValue: {} },
        { provide: getRepositoryToken(Strategy), useValue: strategyRepository },
        { provide: getRepositoryToken(AuditLog), useValue: {} },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
        { provide: ExchangeClientFactory, useValue: exchangeFactory },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('dryRun=true (padrao): lista os trades fantasma mas NAO altera nada no banco', async () => {
    tradeRepository.find.mockResolvedValue([makeOpenTrade()]);
    exchangeClient.getPositions.mockResolvedValue([]);

    const result = await service.reconcileGhostTrades(true);

    expect(result.dryRun).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.ghostTrades).toHaveLength(1);
    expect(result.ghostTrades[0]).toMatchObject({ tradeId: 'trade-1', symbol: 'DOGEUSDT', side: 'SELL' });
    expect(result.closed).toBe(0);
    expect(tradeRepository.update).not.toHaveBeenCalled();
  });

  it('dryRun=false: fecha os trades fantasma com closeReason POSITION_NOT_FOUND e excludeFromStats', async () => {
    tradeRepository.find.mockResolvedValue([makeOpenTrade()]);
    exchangeClient.getPositions.mockResolvedValue([]);

    const result = await service.reconcileGhostTrades(false);

    expect(result.closed).toBe(1);
    expect(tradeRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({
      status: 'CLOSED',
      closeReason: 'POSITION_NOT_FOUND',
      excludeFromStats: true,
    }));
  });

  it('trade com posicao viva na corretora NAO e considerado fantasma', async () => {
    tradeRepository.find.mockResolvedValue([makeOpenTrade()]);
    exchangeClient.getPositions.mockResolvedValue([
      { symbol: 'DOGEUSDT', side: 'SELL', size: '390', avgPrice: '0.08', unrealizedPnl: '0', leverage: '50', markPrice: '0.08' },
    ]);

    const result = await service.reconcileGhostTrades(false);

    expect(result.ghostTrades).toHaveLength(0);
    expect(tradeRepository.update).not.toHaveBeenCalled();
  });

  it('falha ao consultar a corretora para um trade nao interrompe a verificacao dos demais', async () => {
    tradeRepository.find.mockResolvedValue([
      makeOpenTrade({ id: 'trade-1', strategyId: 's1' }),
      makeOpenTrade({ id: 'trade-2', strategyId: 's1', symbol: 'BTCUSDT' }),
    ]);
    exchangeClient.getPositions
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([]);

    const result = await service.reconcileGhostTrades(true);

    expect(result.checked).toBe(2);
    expect(result.ghostTrades).toHaveLength(1);
    expect(result.ghostTrades[0].tradeId).toBe('trade-2');
  });
});
