export interface TakeProfitCloseDecisionInput {
  exchangePositionSize: number | null;
  minQty: number;
}

export type TakeProfitCloseDecisionReason =
  | 'POSITION_CONFIRMED_CLOSED'
  | 'POSITION_STILL_OPEN'
  | 'QUERY_FAILED_FALLBACK_CLOSE';

export interface TakeProfitCloseDecisionResult {
  shouldClose: boolean;
  reason: TakeProfitCloseDecisionReason;
}

export function decideTakeProfitClose(input: TakeProfitCloseDecisionInput): TakeProfitCloseDecisionResult {
  if (input.exchangePositionSize === null) {
    return { shouldClose: true, reason: 'QUERY_FAILED_FALLBACK_CLOSE' };
  }
  if (input.exchangePositionSize > input.minQty) {
    return { shouldClose: false, reason: 'POSITION_STILL_OPEN' };
  }
  return { shouldClose: true, reason: 'POSITION_CONFIRMED_CLOSED' };
}
