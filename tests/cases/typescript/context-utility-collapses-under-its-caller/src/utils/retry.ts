export async function withRetry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < times; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await backoff(attempt);
    }
  }
  throw last;
}

export function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
}
