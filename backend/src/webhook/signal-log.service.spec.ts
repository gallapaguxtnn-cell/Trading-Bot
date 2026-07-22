import { decisionFromResult, SignalLogService } from './signal-log.service';

describe('decisionFromResult (decisão por caminho do webhook)', () => {
  it('executed com tradeId', () => {
    expect(decisionFromResult({ status: 'success', message: 'Order Executed', trade: { id: 't1' } }))
      .toEqual({ decision: 'executed', reason: 'Order Executed', tradeId: 't1' });
  });
  it('skipped_paused', () => {
    expect(decisionFromResult({ status: 'skipped', message: 'Strategy is paused' }).decision).toBe('skipped_paused');
  });
  it('skipped_new_orders_paused', () => {
    expect(decisionFromResult({ status: 'skipped', message: 'New orders paused for this strategy' }).decision).toBe('skipped_new_orders_paused');
  });
  it('skipped_single_mode', () => {
    expect(decisionFromResult({ status: 'skipped', message: 'Single mode: Trade cycle completed. Reset to continue trading.' }).decision).toBe('skipped_single_mode');
  });
  it('skipped_position_open', () => {
    expect(decisionFromResult({ status: 'skipped', message: 'Position already open (averaging disabled)' }).decision).toBe('skipped_position_open');
  });
  it('error', () => {
    expect(decisionFromResult({ status: 'error', message: 'boom' }).decision).toBe('error');
  });
});

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('SignalLogService (append-only, nunca bloqueia o webhook)', () => {
  it('record retorna id e remove o secret do payload', () => {
    const repo = makeRepo();
    const svc = new SignalLogService(repo);
    const id = svc.record({ secret: 'top', strategyId: 's1', symbol: 'BTCUSDT', action: 'buy', price: 1 });
    expect(typeof id).toBe('string');
    const arg = repo.insert.mock.calls[0][0];
    expect(arg.payload.secret).toBeUndefined();
    expect(arg.payload.strategyId).toBe('s1');
    expect(arg.strategyId).toBe('s1');
    expect(arg.action).toBe('BUY');
    expect(arg.decision).toBe('error');
  });

  it('record não lança quando o repo lança de forma síncrona', () => {
    const repo = makeRepo({ insert: () => { throw new Error('db down'); } });
    const svc = new SignalLogService(repo);
    expect(() => svc.record({ strategyId: 's' })).not.toThrow();
  });

  it('record não derruba o processo quando o insert rejeita', async () => {
    const repo = makeRepo({ insert: jest.fn().mockRejectedValue(new Error('db')) });
    const svc = new SignalLogService(repo);
    const id = svc.record({ strategyId: 's' });
    expect(id).toBeTruthy();
    await flush();
  });

  it('decide atualiza a decisão após o insert e nunca lança', async () => {
    const repo = makeRepo();
    const svc = new SignalLogService(repo);
    const id = svc.record({ strategyId: 's' });
    expect(() => svc.decide(id, 'executed', 'ok', 't1')).not.toThrow();
    await flush();
    expect(repo.update).toHaveBeenCalledWith({ id }, { decision: 'executed', decisionReason: 'ok', tradeId: 't1' });
  });

  it('decide engole a rejeição do update', async () => {
    const repo = makeRepo({ update: jest.fn().mockRejectedValue(new Error('db')) });
    const svc = new SignalLogService(repo);
    const id = svc.record({ strategyId: 's' });
    expect(() => svc.decide(id, 'error', 'boom')).not.toThrow();
    await flush();
  });

  it('query filtra por período e limita a 2000', async () => {
    const repo = makeRepo();
    const svc = new SignalLogService(repo);
    await svc.query({ strategyId: 's1', from: new Date('2025-01-01'), to: new Date('2025-02-01'), limit: 99999 });
    const arg = repo.find.mock.calls[0][0];
    expect(arg.where.strategyId).toBe('s1');
    expect(arg.where.receivedAt).toBeDefined();
    expect(arg.order).toEqual({ receivedAt: 'DESC' });
    expect(arg.take).toBe(2000);
  });
});
