// Accessors, static members, enum members, and index-signature access.

export enum Level {
  Low = "low",
  High = "high",
}

export class Counter {
  private n = 0;
  static readonly zero = new Counter();

  get current(): number {
    return this.n;
  }
  set current(v: number) {
    this.n = v;
  }
  static make(): Counter {
    return new Counter();
  }
  bump(): number {
    this.current = this.current + 1;
    return this.current;
  }
}

export function drive(): string {
  // A static factory whose RETURN type is the next receiver.
  const c = Counter.make();
  const z = Counter.zero;
  return String(c.bump()) + String(z.current) + Level.High;
}

// ── client -> library ────────────────────────────────────────────────────────
import { Gauge, Unit } from "../lib/metrics";

export function useLibrary(): string {
  // A LIBRARY static factory whose return type is the next receiver.
  const g = Gauge.create();
  return String(g.record(1)) + String(g.value) + Unit.Ms;
}
