jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as fs from 'fs';
import { AdminService } from './admin.service';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { SignalLog } from '../webhook/signal-log.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { AuditLog, AuditCategory } from '../auditor/audit-log.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { BybitClientService } from '../exchange/bybit-client.service';

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepository },
        { provide: getRepositoryToken(TradeExecution), useValue: executionRepository },
        { provide: getRepositoryToken(SignalLog), useValue: signalLogRepository },
        { provide: getRepositoryToken(Strategy), useValue: strategyRepository },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepository },
        { provide: CredentialsResolverService, useValue: credentialsResolver },
        { provide: BybitClientService, useValue: bybitClient },
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

    expect(bybitClient.cancelOrder).toHaveBeenCalledWith('plain-key', 'plain-secret', true, 'BTCUSDT', 'order-123', 'BRA_BTL');
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
