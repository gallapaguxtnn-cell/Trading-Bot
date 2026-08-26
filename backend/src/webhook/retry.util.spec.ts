import { withOneRetry } from './retry.util';

describe('withOneRetry', () => {
  it('returns the result of the first attempt when it succeeds, without sleeping', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withOneRetry(fn, sleep);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries once after a failure, sleeping the given backoff first', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok on retry');

    const result = await withOneRetry(fn, sleep, 500);

    expect(result).toBe('ok on retry');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('propagates the second failure when the retry also fails (does not retry a third time)', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    await expect(withOneRetry(fn, sleep)).rejects.toThrow('second failure');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
