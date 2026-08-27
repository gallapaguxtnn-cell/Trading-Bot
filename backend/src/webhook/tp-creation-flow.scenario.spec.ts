import Decimal from 'decimal.js';
import { planTakeProfits, buildEnabledTpConfigs, buildTpWarnings } from './tp-planner.util';
import { withOneRetry } from './retry.util';

describe('Cenario de aceite: PLANO_FIX_TP_PLANNER_STEP (DEFEITO 2 -- planner alimentado com a quantidade executada)', () => {
  it('alimentar o planner com a quantidade CALCULADA (targetNotional/preco) em vez da EXECUTADA faz os TPs excederem a posicao real quando ha fill parcial/slippage', () => {
    const strategy = {
      takeProfitPercentage1: 1, takeProfitQuantity1: 33, enableTakeProfit1: true,
      takeProfitPercentage2: 2, takeProfitQuantity2: 33, enableTakeProfit2: true,
      takeProfitPercentage3: 3, takeProfitQuantity3: 34, enableTakeProfit3: true,
    };
    const enabledTps = buildEnabledTpConfigs(strategy);

    const calculatedQuantity = 1000;
    const reallyExecutedQuantity = 950;

    const planFedWithCalculated = planTakeProfits({
      quantity: calculatedQuantity,
      tps: enabledTps.map(tp => ({ ...tp, price: 3 })),
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });
    const sumFedWithCalculated = planFedWithCalculated.planned.reduce((s, tp) => s.plus(tp.quantity), new Decimal(0));
    expect(sumFedWithCalculated.greaterThan(reallyExecutedQuantity)).toBe(true);

    const planFedWithExecuted = planTakeProfits({
      quantity: reallyExecutedQuantity,
      tps: enabledTps.map(tp => ({ ...tp, price: 3 })),
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });
    const sumFedWithExecuted = planFedWithExecuted.planned.reduce((s, tp) => s.plus(tp.quantity), new Decimal(0));
    expect(sumFedWithExecuted.toNumber()).toBe(reallyExecutedQuantity);
  });
});

describe('Cenario de aceite: PLANO_FIX_TPS_DESATIVANDO (plano -> criacao -> retry -> tpWarnings)', () => {
  it('SUIUSDT 1790, 33/33/34, step 1: nenhum residuo e nenhum TP sumindo', async () => {
    const strategy = {
      takeProfitPercentage1: 1, takeProfitQuantity1: 33, enableTakeProfit1: true,
      takeProfitPercentage2: 2, takeProfitQuantity2: 33, enableTakeProfit2: true,
      takeProfitPercentage3: 3, takeProfitQuantity3: 34, enableTakeProfit3: true,
    };

    const enabledTps = buildEnabledTpConfigs(strategy);
    const plan = planTakeProfits({
      quantity: 1790,
      tps: enabledTps.map(tp => ({ ...tp, price: 3 })),
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });

    expect(plan.discarded).toEqual([]);
    expect(plan.planned.map(tp => tp.quantity)).toEqual(['590', '590', '610']);
    const totalPlanned = plan.planned.reduce((sum, tp) => sum + Number(tp.quantity), 0);
    expect(totalPlanned).toBe(1790);
  });

  it('TP2 falha na corretora e se recupera no retry; TP3 falha nas duas tentativas: trade fica com TP1+TP2 e tpWarnings aponta so o TP3', async () => {
    const strategy = {
      takeProfitPercentage1: 1, takeProfitQuantity1: 33, enableTakeProfit1: true,
      takeProfitPercentage2: 2, takeProfitQuantity2: 33, enableTakeProfit2: true,
      takeProfitPercentage3: 3, takeProfitQuantity3: 34, enableTakeProfit3: true,
    };

    const enabledTps = buildEnabledTpConfigs(strategy);
    const plan = planTakeProfits({
      quantity: 1790,
      tps: enabledTps.map(tp => ({ ...tp, price: 3 })),
      qtyStep: '1',
      minQty: '1',
      minNotional: 5,
    });

    const attemptsByTp: Record<number, number> = {};
    const fakeCreateOrder = async (tpId: number) => {
      attemptsByTp[tpId] = (attemptsByTp[tpId] || 0) + 1;
      if (tpId === 2 && attemptsByTp[tpId] === 1) throw new Error('position not synced yet');
      if (tpId === 3) throw new Error('order would immediately trigger');
      return { orderId: `exchange-order-${tpId}` };
    };
    const noopSleep = async () => {};

    const tpOrderIds: string[] = [];
    const failedTps: Array<{ id: number; reason: string }> = [];

    for (const tp of plan.planned) {
      try {
        const order = await withOneRetry(() => fakeCreateOrder(tp.id), noopSleep);
        tpOrderIds.push(`${tp.id}:${order.orderId}`);
      } catch (e: any) {
        failedTps.push({ id: tp.id, reason: e.message });
      }
    }

    expect(attemptsByTp[1]).toBe(1);
    expect(attemptsByTp[2]).toBe(2);
    expect(attemptsByTp[3]).toBe(2);
    expect(tpOrderIds).toEqual(['1:exchange-order-1', '2:exchange-order-2']);

    const tpWarnings = buildTpWarnings(plan.discarded, failedTps);
    expect(tpWarnings).toBe('TP3:REJECTED_BY_EXCHANGE');
  });
});
