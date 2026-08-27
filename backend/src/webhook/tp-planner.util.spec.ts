import Decimal from 'decimal.js';
import { planTakeProfits, buildEnabledTpConfigs, buildTpWarnings } from './tp-planner.util';

describe('planTakeProfits', () => {
  it('DEFEITO 1/2: quantidade fracionaria (1171.9 / 0.65470) com step 1 produz fatias inteiras somando o floor da quantidade', () => {
    const quantity = 1171.9 / 0.65470;
    const result = planTakeProfits({
      quantity,
      tps: [
        { id: 1, percent: 1, qtyPercent: 33, price: 3 },
        { id: 2, percent: 2, qtyPercent: 33, price: 3 },
        { id: 3, percent: 3, qtyPercent: 34, price: 3 },
      ],
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });

    for (const tp of result.planned) {
      expect(new Decimal(tp.quantity).mod('1').isZero()).toBe(true);
    }
    expect(result.planned.map((tp) => tp.quantity)).toEqual(['590', '590', '609']);
    const sum = result.planned.reduce((s, tp) => s.plus(tp.quantity), new Decimal(0));
    expect(sum.toNumber()).toBe(1789);
  });


  it('splits 1790 SUI at 33/33/34 with step 1 without leftover (last slice absorbs the residue)', () => {
    const result = planTakeProfits({
      quantity: 1790,
      tps: [
        { id: 1, percent: 1, qtyPercent: 33, price: 3 },
        { id: 2, percent: 2, qtyPercent: 33, price: 3 },
        { id: 3, percent: 3, qtyPercent: 34, price: 3 },
      ],
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });

    expect(result.discarded).toEqual([]);
    expect(result.planned.map((tp) => tp.quantity)).toEqual(['590', '590', '610']);
    const sum = result.planned.reduce((s, tp) => s + Number(tp.quantity), 0);
    expect(sum).toBe(1790);
  });

  it('discards a TP below minNotional and redistributes its share to the survivors, preserving the total', () => {
    const result = planTakeProfits({
      quantity: 30,
      tps: [
        { id: 1, percent: 1, qtyPercent: 5, price: 1 },
        { id: 2, percent: 2, qtyPercent: 45, price: 1 },
        { id: 3, percent: 3, qtyPercent: 50, price: 1 },
      ],
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });

    expect(result.discarded).toEqual([{ id: 1, percent: 1, reason: 'BELOW_MIN_NOTIONAL' }]);
    expect(result.planned.map((tp) => tp.id)).toEqual([2, 3]);
    const sum = result.planned.reduce((s, tp) => s + Number(tp.quantity), 0);
    expect(sum).toBe(30);
  });

  it('returns an empty plan with explicit reasons when no TP is viable, without throwing', () => {
    const result = planTakeProfits({
      quantity: 0.0004,
      tps: [
        { id: 1, percent: 1, qtyPercent: 33, price: 50000 },
        { id: 2, percent: 2, qtyPercent: 33, price: 50000 },
        { id: 3, percent: 3, qtyPercent: 34, price: 50000 },
      ],
      qtyStep: '0.001',
      minQty: '0.001',
      minNotional: 5,
    });

    expect(result.planned).toEqual([]);
    expect(result.discarded).toHaveLength(3);
    expect(result.discarded.every((d) => d.reason === 'BELOW_MIN_QTY')).toBe(true);
  });

  it('never invents a synthetic 50/50 split: each planned TP keeps its own configured percent', () => {
    const result = planTakeProfits({
      quantity: 10,
      tps: [
        { id: 1, percent: 1, qtyPercent: 33, price: 1 },
        { id: 2, percent: 2, qtyPercent: 33, price: 1 },
        { id: 3, percent: 3, qtyPercent: 34, price: 1 },
      ],
      qtyStep: '1',
      minQty: '1',
      minNotional: 1,
    });

    expect(result.planned.map((tp) => ({ id: tp.id, percent: tp.percent }))).toEqual([
      { id: 1, percent: 1 },
      { id: 2, percent: 2 },
      { id: 3, percent: 3 },
    ]);
  });

  it('DEFEITO 1: toda fatia planejada e multipla exata do qtyStep, e a soma bate com floorToStep(quantity) -- nunca com a quantidade bruta', () => {
    const cases: Array<{ quantity: number; qtyStep: string }> = [
      { quantity: 1.2345001, qtyStep: '0.001' },
      { quantity: 123.4567, qtyStep: '0.01' },
      { quantity: 1171.9 / 0.65470, qtyStep: '1' },
      { quantity: 12345.678, qtyStep: '10' },
    ];

    for (const { quantity, qtyStep } of cases) {
      const dStep = new Decimal(qtyStep);
      const result = planTakeProfits({
        quantity,
        tps: [
          { id: 1, percent: 1, qtyPercent: 33, price: 1 },
          { id: 2, percent: 2, qtyPercent: 33, price: 1 },
          { id: 3, percent: 3, qtyPercent: 34, price: 1 },
        ],
        qtyStep,
        minQty: qtyStep,
        minNotional: 0,
      });

      for (const tp of result.planned) {
        expect(new Decimal(tp.quantity).mod(dStep).isZero()).toBe(true);
      }

      const sum = result.planned.reduce((s, tp) => s.plus(tp.quantity), new Decimal(0));
      const expectedSum = new Decimal(quantity).div(dStep).floor().mul(dStep);
      expect(sum.equals(expectedSum)).toBe(true);
    }
  });

  it('revalida a ultima fatia apos receber o resto: descarta se qtyPercent mal configurado (soma > 100%) a deixa abaixo de minQty', () => {
    const result = planTakeProfits({
      quantity: 100,
      tps: [
        { id: 1, percent: 1, qtyPercent: 90, price: 1 },
        { id: 2, percent: 2, qtyPercent: 90, price: 1 },
      ],
      qtyStep: '1',
      minQty: '15',
      minNotional: 0,
    });

    expect(result.planned).toEqual([{ id: 1, percent: 1, quantity: '90' }]);
    expect(result.discarded).toEqual([{ id: 2, percent: 2, reason: 'BELOW_MIN_QTY' }]);
  });

  it('quando a quantidade e menor que um step inteiro, floorToStep(quantity) e zero: nenhum TP e criado', () => {
    const result = planTakeProfits({
      quantity: 0.7,
      tps: [
        { id: 1, percent: 1, qtyPercent: 33, price: 1 },
        { id: 2, percent: 2, qtyPercent: 33, price: 1 },
        { id: 3, percent: 3, qtyPercent: 34, price: 1 },
      ],
      qtyStep: '1',
      minQty: '1',
      minNotional: 0,
    });

    expect(result.planned).toEqual([]);
    expect(result.discarded).toEqual([
      { id: 1, percent: 1, reason: 'BELOW_MIN_QTY' },
      { id: 2, percent: 2, reason: 'BELOW_MIN_QTY' },
      { id: 3, percent: 3, reason: 'BELOW_MIN_QTY' },
    ]);
  });
});

describe('buildEnabledTpConfigs', () => {
  it('excludes a disabled TP entirely from the plan', () => {
    const configs = buildEnabledTpConfigs({
      takeProfitPercentage1: 1,
      takeProfitQuantity1: 33,
      enableTakeProfit1: true,
      takeProfitPercentage2: 2,
      takeProfitQuantity2: 33,
      enableTakeProfit2: false,
      takeProfitPercentage3: 3,
      takeProfitQuantity3: 34,
      enableTakeProfit3: true,
    });

    expect(configs.map((c) => c.id)).toEqual([1, 3]);
  });

  it('defaults enable flags to true when undefined (legacy strategies)', () => {
    const configs = buildEnabledTpConfigs({
      takeProfitPercentage1: 1,
      takeProfitPercentage2: 2,
      takeProfitPercentage3: 3,
    });

    expect(configs.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('excludes a TP without a configured percentage even if enabled', () => {
    const configs = buildEnabledTpConfigs({
      takeProfitPercentage1: 1,
      enableTakeProfit1: true,
      takeProfitPercentage2: null,
      enableTakeProfit2: true,
      takeProfitPercentage3: 3,
      enableTakeProfit3: true,
    });

    expect(configs.map((c) => c.id)).toEqual([1, 3]);
  });
});

describe('buildTpWarnings', () => {
  it('returns null when nothing was discarded or failed', () => {
    expect(buildTpWarnings([], [])).toBeNull();
  });

  it('combines discard reasons and exchange failures into a single summary string', () => {
    const result = buildTpWarnings(
      [{ id: 2, percent: 2, reason: 'BELOW_MIN_NOTIONAL' }],
      [{ id: 3, reason: 'insufficient balance' }],
    );

    expect(result).toBe('TP2:BELOW_MIN_NOTIONAL;TP3:REJECTED_BY_EXCHANGE');
  });
});
