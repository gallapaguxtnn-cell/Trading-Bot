import { buildSignalIdempotencyKey, isWithinIdempotencyWindow } from './signal-idempotency.util';

describe('buildSignalIdempotencyKey', () => {
  it('combina strategyId, symbol, action e barTime em uma chave estavel', () => {
    const key = buildSignalIdempotencyKey({ strategyId: 's1', symbol: 'DOGEUSDT', action: 'buy', barTime: '2026-09-19T19:43:00Z' });
    expect(key).toBe('s1:DOGEUSDT:buy:2026-09-19T19:43:00Z');
  });

  it('sem barTime (payload atual do TradingView nao envia isso hoje) -> chave ainda estavel, so sem o sufixo', () => {
    const key = buildSignalIdempotencyKey({ strategyId: 's1', symbol: 'DOGEUSDT', action: 'buy' });
    expect(key).toBe('s1:DOGEUSDT:buy:');
  });

  it('barTime diferente produz chaves diferentes (candles diferentes nao sao duplicata)', () => {
    const a = buildSignalIdempotencyKey({ strategyId: 's1', symbol: 'DOGEUSDT', action: 'buy', barTime: '19:43' });
    const b = buildSignalIdempotencyKey({ strategyId: 's1', symbol: 'DOGEUSDT', action: 'buy', barTime: '19:44' });
    expect(a).not.toBe(b);
  });
});

describe('isWithinIdempotencyWindow', () => {
  it('sem processamento anterior -> nunca e duplicata', () => {
    expect(isWithinIdempotencyWindow(undefined, Date.now(), 60000)).toBe(false);
  });

  it('processado ha 12s (caso real do log: 3 POSTs em 12s) -> dentro da janela de 60s', () => {
    const lastProcessedAt = 1000;
    const now = lastProcessedAt + 12000;
    expect(isWithinIdempotencyWindow(lastProcessedAt, now, 60000)).toBe(true);
  });

  it('processado ha exatamente 60s -> fora da janela (limite exclusivo)', () => {
    const lastProcessedAt = 1000;
    const now = lastProcessedAt + 60000;
    expect(isWithinIdempotencyWindow(lastProcessedAt, now, 60000)).toBe(false);
  });

  it('processado ha 61s -> fora da janela, sinal tratado como novo', () => {
    const lastProcessedAt = 1000;
    const now = lastProcessedAt + 61000;
    expect(isWithinIdempotencyWindow(lastProcessedAt, now, 60000)).toBe(false);
  });
});
