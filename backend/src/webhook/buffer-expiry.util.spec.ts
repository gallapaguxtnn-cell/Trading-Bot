import { decideLimitSyncAction } from './buffer-expiry.util';

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
