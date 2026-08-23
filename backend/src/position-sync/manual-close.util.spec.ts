import { resolveManualCloseOutcome } from './manual-close.util';

describe('resolveManualCloseOutcome', () => {
  it('sem execucoes previas: pnl = so o segmento, motivo MANUAL', () => {
    const result = resolveManualCloseOutcome([], 12.5);
    expect(result.totalPnl).toBe(12.5);
    expect(result.closeReason).toBe('MANUAL');
  });

  it('caso real: TP1 ja realizado (+2.5955) nao pode ser descartado ao fechar o restante', () => {
    const priorExecutions = [
      { type: 'ENTRY', pnl: null },
      { type: 'TAKE_PROFIT_1', pnl: 2.5955 },
    ];
    const result = resolveManualCloseOutcome(priorExecutions, -0.089);

    expect(result.totalPnl).toBeCloseTo(2.5065, 4);
    expect(result.closeReason).toBe('TAKE_PROFIT_1');
  });

  it('TP1 e TP2 previos: motivo reflete o nivel mais alto ja executado, nao MANUAL', () => {
    const priorExecutions = [
      { type: 'ENTRY', pnl: null },
      { type: 'TAKE_PROFIT_1', pnl: 1 },
      { type: 'TAKE_PROFIT_2', pnl: 2 },
    ];
    const result = resolveManualCloseOutcome(priorExecutions, 0.5);

    expect(result.totalPnl).toBeCloseTo(3.5, 10);
    expect(result.closeReason).toBe('TAKE_PROFIT_2');
  });

  it('SL parcial previo (software-monitored) rotula como STOP_LOSS', () => {
    const priorExecutions = [
      { type: 'ENTRY', pnl: null },
      { type: 'STOP_LOSS', pnl: -1.2 },
    ];
    const result = resolveManualCloseOutcome(priorExecutions, -0.3);

    expect(result.totalPnl).toBeCloseTo(-1.5, 10);
    expect(result.closeReason).toBe('STOP_LOSS');
  });

  it('execucoes com pnl null sao ignoradas na soma', () => {
    const priorExecutions = [
      { type: 'TAKE_PROFIT_1', pnl: null },
    ];
    const result = resolveManualCloseOutcome(priorExecutions, 5);
    expect(result.totalPnl).toBe(5);
  });
});
