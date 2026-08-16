import { decideLimitSyncAction, shouldCancelPendingForStrategy } from './buffer-expiry.util';

describe('decideLimitSyncAction', () => {
  it('keeps a pending order (never expires by time anymore)', () => {
    expect(decideLimitSyncAction({ orderStatus: 'New', hasProtection: false })).toBe('keep');
    expect(decideLimitSyncAction({ orderStatus: 'PartiallyFilled', hasProtection: false })).toBe('keep');
    expect(decideLimitSyncAction({ orderStatus: 'PARTIALLY_FILLED', hasProtection: false })).toBe('keep');
  });

  it('requests protection for a filled order without SL/TP', () => {
    expect(decideLimitSyncAction({ orderStatus: 'Filled', hasProtection: false })).toBe('protect');
  });

  it('does nothing for a filled order that already has protection', () => {
    expect(decideLimitSyncAction({ orderStatus: 'Filled', hasProtection: true })).toBe('none');
  });

  it('does nothing for cancelled/rejected/unknown statuses', () => {
    expect(decideLimitSyncAction({ orderStatus: 'Cancelled', hasProtection: false })).toBe('none');
    expect(decideLimitSyncAction({ orderStatus: 'Rejected', hasProtection: false })).toBe('none');
    expect(decideLimitSyncAction({ orderStatus: null, hasProtection: false })).toBe('none');
  });
});

describe('shouldCancelPendingForStrategy', () => {
  it('keeps pending orders for an active, non-paused strategy', () => {
    expect(shouldCancelPendingForStrategy({ isActive: true, pauseNewOrders: false })).toBe(false);
  });

  it('cancels pending orders when the strategy is disabled', () => {
    expect(shouldCancelPendingForStrategy({ isActive: false, pauseNewOrders: false })).toBe(true);
  });

  it('cancels pending orders when new orders are paused', () => {
    expect(shouldCancelPendingForStrategy({ isActive: true, pauseNewOrders: true })).toBe(true);
  });

  it('cancels pending orders for a missing (deleted) strategy', () => {
    expect(shouldCancelPendingForStrategy(null)).toBe(true);
  });
});
