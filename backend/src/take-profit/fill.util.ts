export interface OrderFill {
  status: string | null;
  avgPrice: number | null;
  executedQty: number | null;
  fee: number | null;
  updatedAt: Date | null;
}

function toNum(v: unknown): number | null {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toPos(v: unknown): number | null {
  const n = toNum(v);
  return n != null && n > 0 ? n : null;
}

function toDate(ms: unknown): Date | null {
  const n = parseFloat(String(ms));
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

export function mapBybitFill(o: Record<string, unknown> | null | undefined): OrderFill | null {
  if (!o) return null;
  return {
    status: (o.orderStatus as string) ?? null,
    avgPrice: toPos(o.avgPrice),
    executedQty: toPos(o.cumExecQty),
    fee: toNum(o.cumExecFee),
    updatedAt: toDate(o.updatedTime),
  };
}

export function mapBinanceFill(d: Record<string, unknown> | null | undefined): OrderFill | null {
  if (!d) return null;
  return {
    status: (d.status as string) ?? null,
    avgPrice: toPos(d.avgPrice),
    executedQty: toPos(d.executedQty),
    fee: null,
    updatedAt: toDate(d.updateTime),
  };
}

export function weightedAvgPrice(fills: Array<OrderFill | null | undefined>): number | null {
  let num = 0;
  let den = 0;
  for (const f of fills) {
    if (f && f.avgPrice != null && f.executedQty != null && f.executedQty > 0) {
      num += f.avgPrice * f.executedQty;
      den += f.executedQty;
    }
  }
  return den > 0 ? num / den : null;
}

export function tpPnl(side: string, entryPrice: number, fillPrice: number, closedQty: number, fee: number | null | undefined): { gross: number; net: number } {
  const gross = (side === 'BUY' ? fillPrice - entryPrice : entryPrice - fillPrice) * closedQty;
  const net = gross - (fee ?? 0);
  return { gross, net };
}

export function latestUpdatedAt(fills: Array<OrderFill | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const f of fills) {
    if (f && f.updatedAt && (!latest || f.updatedAt.getTime() > latest.getTime())) latest = f.updatedAt;
  }
  return latest;
}
