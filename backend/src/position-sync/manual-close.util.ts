export interface PriorExecutionSummary {
  type: string;
  pnl: number | null;
}

export type ManualCloseReason = 'TAKE_PROFIT_1' | 'TAKE_PROFIT_2' | 'TAKE_PROFIT_3' | 'STOP_LOSS' | 'MANUAL';

export interface ManualCloseOutcome {
  totalPnl: number;
  closeReason: ManualCloseReason;
}

export function resolveManualCloseOutcome(
  priorExecutions: PriorExecutionSummary[],
  segmentPnl: number,
): ManualCloseOutcome {
  const priorRealizedPnl = priorExecutions
    .filter(e => e.type !== 'ENTRY' && e.pnl !== null)
    .reduce((sum, e) => sum + Number(e.pnl), 0);

  const tpLevels = priorExecutions
    .map(e => /^TAKE_PROFIT_(\d)$/.exec(e.type)?.[1])
    .filter((level): level is string => !!level)
    .map(Number);

  const hasStopLoss = priorExecutions.some(e => e.type === 'STOP_LOSS');

  let closeReason: ManualCloseReason = 'MANUAL';
  if (tpLevels.length > 0) {
    closeReason = `TAKE_PROFIT_${Math.max(...tpLevels)}` as ManualCloseReason;
  } else if (hasStopLoss) {
    closeReason = 'STOP_LOSS';
  }

  return {
    totalPnl: priorRealizedPnl + segmentPnl,
    closeReason,
  };
}
