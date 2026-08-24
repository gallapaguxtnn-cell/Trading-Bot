import { findDuplicatePositionGroups, planDedupe } from './duplicate-position.util';
import { TradesService } from '../trades/trades.service';

describe('Cenario de aceite: PLANO_FIX_TRADES_DUPLICADOS (print real A/B/C/D)', () => {
  const tradeA = {
    id: 'trade-a', symbol: 'SUIUSDT', side: 'BUY', entryPrice: 0.65470,
    closedAt: '2026-08-19T04:00:00Z', pnl: 5.4555,
  };
  const tradeB = {
    id: 'trade-b', symbol: 'SUIUSDT', side: 'BUY', entryPrice: 0.65470,
    closedAt: '2026-08-19T04:05:00Z', pnl: 2.506,
  };
  const tradeC = {
    id: 'trade-c', symbol: 'SUIUSDT', side: 'BUY', entryPrice: 0.71930,
    closedAt: '2026-08-19T23:00:00Z', pnl: 0.2672,
  };
  const tradeD = {
    id: 'trade-d', symbol: 'SUIUSDT', side: 'BUY', entryPrice: 0.71930,
    closedAt: '2026-08-19T23:05:00Z', pnl: 0.0565,
  };
  const tradeE = {
    id: 'trade-e', symbol: 'SUIUSDT', side: 'SELL', entryPrice: 0.70930,
    closedAt: '2026-08-19T23:10:00Z', pnl: 3.0553,
  };

  const allTrades = [tradeA, tradeB, tradeC, tradeD, tradeE];

  it('auditor encontra exatamente os pares A+B e C+D, e nao mistura com E (side diferente)', () => {
    const groups = findDuplicatePositionGroups(allTrades);

    expect(groups).toHaveLength(2);
    const idsPerGroup = groups.map(g => g.trades.map(t => t.id).sort());
    expect(idsPerGroup).toContainEqual(['trade-a', 'trade-b']);
    expect(idsPerGroup).toContainEqual(['trade-c', 'trade-d']);
    expect(idsPerGroup.flat()).not.toContain('trade-e');
  });

  it('dedupe em dryRun mantem A e C (mais antigos, os corretos) e marcaria B e D', () => {
    const plan = planDedupe(findDuplicatePositionGroups(allTrades));

    const planForAB = plan.find(p => p.groupTradeIds.includes('trade-a'))!;
    const planForCD = plan.find(p => p.groupTradeIds.includes('trade-c'))!;

    expect(planForAB.keepTradeId).toBe('trade-a');
    expect(planForAB.markTradeIds).toEqual(['trade-b']);
    expect(planForCD.keepTradeId).toBe('trade-c');
    expect(planForCD.markTradeIds).toEqual(['trade-d']);
  });

  it('apos aplicar o dedupe (B e D marcados excludeFromStats), o acumulado do dashboard cai para o valor real da corretora', async () => {
    const dedupedTrades = allTrades.map(t => ({
      ...t,
      excludeFromStats: t.id === 'trade-b' || t.id === 'trade-d',
      status: 'CLOSED',
      timestamp: t.closedAt,
    }));

    const tradesRepository = {
      find: jest.fn().mockImplementation(({ where }: any) => {
        if (where.status === 'OPEN') return Promise.resolve([]);
        if (where.status === 'CLOSED') return Promise.resolve(dedupedTrades);
        return Promise.resolve([]);
      }),
    } as any;

    const service = new TradesService(tradesRepository, {} as any, { emit: jest.fn() } as any);
    const stats = await service.getStats();

    const expectedRealPnl = tradeA.pnl + tradeC.pnl + tradeE.pnl;
    expect(stats.realizedPnL).toBeCloseTo(expectedRealPnl, 4);
    expect(stats.totalTrades).toBe(3);

    expect(stats.recentSignals.map((t: any) => t.id).sort()).toEqual(
      ['trade-a', 'trade-b', 'trade-c', 'trade-d', 'trade-e'].sort()
    );
  });
});
