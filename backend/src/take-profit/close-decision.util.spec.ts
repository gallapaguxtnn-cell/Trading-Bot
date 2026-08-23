import { decideTakeProfitClose } from './close-decision.util';

describe('decideTakeProfitClose', () => {
  it('calculo local indica fechado mas corretora ainda tem posicao > minQty -> nao fecha', () => {
    const result = decideTakeProfitClose({ exchangePositionSize: 895, minQty: 1 });
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toBe('POSITION_STILL_OPEN');
  });

  it('posicao confirmada zerada na corretora -> fecha normalmente', () => {
    const result = decideTakeProfitClose({ exchangePositionSize: 0, minQty: 1 });
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('POSITION_CONFIRMED_CLOSED');
  });

  it('posicao abaixo do minQty (poeira irrecuperavel) -> fecha normalmente', () => {
    const result = decideTakeProfitClose({ exchangePositionSize: 0.0005, minQty: 0.001 });
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('POSITION_CONFIRMED_CLOSED');
  });

  it('posicao exatamente no minQty nao e tratada como residuo (fecha)', () => {
    const result = decideTakeProfitClose({ exchangePositionSize: 1, minQty: 1 });
    expect(result.shouldClose).toBe(true);
  });

  it('consulta a corretora falhou (null) -> cai no comportamento atual (fecha) com fallback explicito', () => {
    const result = decideTakeProfitClose({ exchangePositionSize: null, minQty: 1 });
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('QUERY_FAILED_FALLBACK_CLOSE');
  });
});
