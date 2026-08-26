export async function withOneRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  delayMs = 500
): Promise<T> {
  try {
    return await fn();
  } catch (firstError) {
    await sleep(delayMs);
    return fn();
  }
}
