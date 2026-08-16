import { isPendingLimitEntry } from './trade-guards.util';

describe('isPendingLimitEntry', () => {
  it('flags a LIMIT order with no protection yet (still pending fill)', () => {
    expect(isPendingLimitEntry({ type: 'LIMIT', stopLossOrderId: null, takeProfitOrderId: null })).toBe(true);
    expect(isPendingLimitEntry({ type: 'LIMIT' })).toBe(true);
  });

  it('does not flag a LIMIT order that already has protection (filled)', () => {
    expect(isPendingLimitEntry({ type: 'LIMIT', stopLossOrderId: 'sl1', takeProfitOrderId: null })).toBe(false);
    expect(isPendingLimitEntry({ type: 'LIMIT', stopLossOrderId: null, takeProfitOrderId: '1:tp1' })).toBe(false);
    expect(isPendingLimitEntry({ type: 'LIMIT', stopLossOrderId: 'sl1', takeProfitOrderId: '1:tp1' })).toBe(false);
  });

  it('never flags a MARKET order (software TP/SL still applies)', () => {
    expect(isPendingLimitEntry({ type: 'MARKET', stopLossOrderId: null, takeProfitOrderId: null })).toBe(false);
  });

  it('handles undefined/empty input safely', () => {
    expect(isPendingLimitEntry({})).toBe(false);
    expect(isPendingLimitEntry(null as any)).toBe(false);
  });
});
