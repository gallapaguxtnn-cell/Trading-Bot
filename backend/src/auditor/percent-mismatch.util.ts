export interface PercentMismatchInput {
  entryPrice: number;
  exitPrice: number;
  closeReason: string | null;
  closeDetail: string | null;
  stopLossPercentage: number | null;
  takeProfitPercentage1: number | null;
  takeProfitPercentage2: number | null;
  takeProfitPercentage3: number | null;
}

export interface PercentMismatchResult {
  category: 'TP_PERCENT_MISMATCH' | 'SL_PERCENT_MISMATCH';
  configuredPercent: number;
  effectivePercent: number;
  deviation: number;
  severity: 'WARNING' | 'ERROR';
}

const WARNING_THRESHOLD_PP = 0.05;
const ERROR_THRESHOLD_PP = 0.2;

export function computePercentMismatch(input: PercentMismatchInput): PercentMismatchResult | null {
  const { entryPrice, exitPrice, closeReason, closeDetail } = input;
  if (!entryPrice || !exitPrice || !closeReason) return null;

  let category: 'TP_PERCENT_MISMATCH' | 'SL_PERCENT_MISMATCH';
  let configuredPercent: number | null;

  if (closeReason === 'STOP_LOSS') {
    category = 'SL_PERCENT_MISMATCH';
    configuredPercent = input.stopLossPercentage;
  } else if (
    !closeDetail &&
    (closeReason === 'TAKE_PROFIT_1' || closeReason === 'TAKE_PROFIT_2' || closeReason === 'TAKE_PROFIT_3')
  ) {
    category = 'TP_PERCENT_MISMATCH';
    configuredPercent = closeReason === 'TAKE_PROFIT_1' ? input.takeProfitPercentage1
      : closeReason === 'TAKE_PROFIT_2' ? input.takeProfitPercentage2
      : input.takeProfitPercentage3;
  } else {
    return null;
  }

  if (!configuredPercent || configuredPercent <= 0) return null;

  const effectivePercent = Math.abs((exitPrice - entryPrice) / entryPrice) * 100;
  const deviation = Math.abs(effectivePercent - configuredPercent);
  if (deviation <= WARNING_THRESHOLD_PP) return null;

  return {
    category,
    configuredPercent,
    effectivePercent,
    deviation,
    severity: deviation > ERROR_THRESHOLD_PP ? 'ERROR' : 'WARNING',
  };
}
