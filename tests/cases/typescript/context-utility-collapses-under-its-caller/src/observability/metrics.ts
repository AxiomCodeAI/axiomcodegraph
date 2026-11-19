export class Metrics {
  private counts: Record<string, number> = {};

  increment(key: string, value = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + value;
  }

  timing(key: string, started: number): void {
    this.counts[key + ".ms"] = Date.now() - started;
  }
}

export const metrics = new Metrics();

export function increment(key: string, value = 1): void {
  metrics.increment(key, value);
}
