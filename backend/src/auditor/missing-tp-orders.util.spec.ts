import { parseTrackedTpOrders, computeExpectedTpLevels, countLiveTrackedOrders } from './missing-tp-orders.util';

describe('parseTrackedTpOrders', () => {
  it('parses a pipe-joined level:orderId string', () => {
    expect(parseTrackedTpOrders('1:aaa|2:bbb|3:ccc')).toEqual([
      { level: 1, orderId: 'aaa' },
      { level: 2, orderId: 'bbb' },
      { level: 3, orderId: 'ccc' },
    ]);
  });

  it('returns an empty list for null, undefined or empty string', () => {
    expect(parseTrackedTpOrders(null)).toEqual([]);
    expect(parseTrackedTpOrders(undefined)).toEqual([]);
    expect(parseTrackedTpOrders('')).toEqual([]);
  });

  it('ignores malformed entries without dropping the well-formed ones', () => {
    expect(parseTrackedTpOrders('1:aaa|garbage|2:bbb')).toEqual([
      { level: 1, orderId: 'aaa' },
      { level: 2, orderId: 'bbb' },
    ]);
  });
});

describe('computeExpectedTpLevels', () => {
  it('keeps only levels above lastTpLevel', () => {
    expect(computeExpectedTpLevels([1, 2, 3], 1)).toEqual([2, 3]);
  });

  it('returns all enabled levels when nothing has filled yet', () => {
    expect(computeExpectedTpLevels([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('returns an empty list once every enabled TP has already filled', () => {
    expect(computeExpectedTpLevels([1, 2, 3], 3)).toEqual([]);
  });

  it('respects a disabled TP2 (id 2 absent from enabledTpIds)', () => {
    expect(computeExpectedTpLevels([1, 3], 1)).toEqual([3]);
  });
});

describe('countLiveTrackedOrders', () => {
  it('counts only tracked orders that are still open on the exchange', () => {
    const tracked = [
      { level: 2, orderId: 'bbb' },
      { level: 3, orderId: 'ccc' },
    ];
    expect(countLiveTrackedOrders(tracked, new Set(['bbb']))).toBe(1);
  });

  it('returns 0 when none of the tracked orders are still live', () => {
    const tracked = [{ level: 2, orderId: 'bbb' }];
    expect(countLiveTrackedOrders(tracked, new Set(['xyz']))).toBe(0);
  });
});
