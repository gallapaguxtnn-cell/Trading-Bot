import Decimal from 'decimal.js';

export type TpDiscardReason = 'BELOW_MIN_QTY' | 'BELOW_MIN_NOTIONAL';

export interface TpPlanInput {
  id: number;
  percent: number;
  qtyPercent: number;
  price: number;
}

export interface PlannedTakeProfit {
  id: number;
  percent: number;
  quantity: string;
}

export interface DiscardedTakeProfit {
  id: number;
  percent: number;
  reason: TpDiscardReason;
}

export interface TakeProfitPlan {
  planned: PlannedTakeProfit[];
  discarded: DiscardedTakeProfit[];
}

export interface PlanTakeProfitsParams {
  quantity: number;
  tps: TpPlanInput[];
  qtyStep: string;
  minQty: string;
  minNotional: number;
}

export function floorToStep(value: Decimal, step: Decimal): Decimal {
  if (step.isZero()) return value;
  return value.div(step).floor().mul(step);
}

export function planTakeProfits(params: PlanTakeProfitsParams): TakeProfitPlan {
  const { quantity, tps, qtyStep, minQty, minNotional } = params;

  if (tps.length === 0) {
    return { planned: [], discarded: [] };
  }

  const dQuantity = new Decimal(quantity);
  const dStep = new Decimal(qtyStep);
  const dMinQty = new Decimal(minQty);
  const dMinNotional = new Decimal(minNotional);

  if (dQuantity.lessThanOrEqualTo(0)) {
    return {
      planned: [],
      discarded: tps.map((tp) => ({ id: tp.id, percent: tp.percent, reason: 'BELOW_MIN_QTY' as const })),
    };
  }

  const baseQuantity = floorToStep(dQuantity, dStep);

  if (baseQuantity.lessThanOrEqualTo(0)) {
    return {
      planned: [],
      discarded: tps.map((tp) => ({ id: tp.id, percent: tp.percent, reason: 'BELOW_MIN_QTY' as const })),
    };
  }

  const candidates = tps.map((tp) => ({
    ...tp,
    slice: floorToStep(baseQuantity.mul(tp.qtyPercent).div(100), dStep),
  }));

  const discarded: DiscardedTakeProfit[] = [];
  const viable = candidates.filter((tp) => {
    if (tp.slice.lessThan(dMinQty)) {
      discarded.push({ id: tp.id, percent: tp.percent, reason: 'BELOW_MIN_QTY' });
      return false;
    }
    const notional = tp.slice.mul(tp.price);
    if (notional.lessThan(dMinNotional)) {
      discarded.push({ id: tp.id, percent: tp.percent, reason: 'BELOW_MIN_NOTIONAL' });
      return false;
    }
    return true;
  });

  if (viable.length === 0) {
    return { planned: [], discarded };
  }

  const discardedQtyPercent = candidates
    .filter((tp) => discarded.some((d) => d.id === tp.id))
    .reduce((sum, tp) => sum.plus(tp.qtyPercent), new Decimal(0));

  const survivorsWeight = viable.reduce((sum, tp) => sum.plus(tp.qtyPercent), new Decimal(0));
  const discardedQuantity = baseQuantity.mul(discardedQtyPercent).div(100);

  const planned: PlannedTakeProfit[] = viable.map((tp) => {
    const extraShare = discardedQuantity.isZero()
      ? new Decimal(0)
      : discardedQuantity.mul(tp.qtyPercent).div(survivorsWeight);
    const slice = floorToStep(tp.slice.plus(extraShare), dStep);
    return { id: tp.id, percent: tp.percent, quantity: slice.toFixed() };
  });

  const lastIndex = planned.length - 1;
  const sumExceptLast = planned
    .slice(0, -1)
    .reduce((sum, tp) => sum.plus(tp.quantity), new Decimal(0));
  const lastSlice = baseQuantity.minus(sumExceptLast);
  planned[lastIndex] = {
    ...planned[lastIndex],
    quantity: lastSlice.toFixed(),
  };

  const lastNotional = lastSlice.mul(viable[lastIndex].price);
  if (lastSlice.lessThan(dMinQty) || lastNotional.lessThan(dMinNotional)) {
    const removed = planned.pop()!;
    discarded.push({
      id: removed.id,
      percent: removed.percent,
      reason: lastSlice.lessThan(dMinQty) ? 'BELOW_MIN_QTY' : 'BELOW_MIN_NOTIONAL',
    });
  }

  return { planned, discarded };
}

export interface StrategyTpConfig {
  takeProfitPercentage1?: number | null;
  takeProfitQuantity1?: number | null;
  enableTakeProfit1?: boolean | null;
  takeProfitPercentage2?: number | null;
  takeProfitQuantity2?: number | null;
  enableTakeProfit2?: boolean | null;
  takeProfitPercentage3?: number | null;
  takeProfitQuantity3?: number | null;
  enableTakeProfit3?: boolean | null;
}

export interface EnabledTpConfig {
  id: number;
  percent: number;
  qtyPercent: number;
}

export interface FailedTakeProfit {
  id: number;
  reason: string;
}

export function buildTpWarnings(
  discarded: DiscardedTakeProfit[],
  failed: FailedTakeProfit[]
): string | null {
  const parts = [
    ...discarded.map((d) => `TP${d.id}:${d.reason}`),
    ...failed.map((f) => `TP${f.id}:REJECTED_BY_EXCHANGE`),
  ];
  return parts.length > 0 ? parts.join(';') : null;
}

export function buildEnabledTpConfigs(strategy: StrategyTpConfig): EnabledTpConfig[] {
  return [
    {
      id: 1,
      percent: strategy.takeProfitPercentage1,
      qtyPercent: strategy.takeProfitQuantity1 || 33,
      enabled: strategy.enableTakeProfit1 ?? true,
    },
    {
      id: 2,
      percent: strategy.takeProfitPercentage2,
      qtyPercent: strategy.takeProfitQuantity2 || 33,
      enabled: strategy.enableTakeProfit2 ?? true,
    },
    {
      id: 3,
      percent: strategy.takeProfitPercentage3,
      qtyPercent: strategy.takeProfitQuantity3 || 34,
      enabled: strategy.enableTakeProfit3 ?? true,
    },
  ]
    .filter((tp): tp is typeof tp & { percent: number } => !!tp.enabled && !!tp.percent && tp.percent > 0)
    .map(({ id, percent, qtyPercent }) => ({ id, percent, qtyPercent }));
}
