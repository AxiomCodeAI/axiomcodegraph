// Overload selection. Every call below picks a NON-FIRST declaration at least
// once, so a golden that matches by declaration order alone cannot pass.

export function format(value: string): string;
export function format(value: number, digits: number): string;
export function format(value: boolean): string;
export function format(value: unknown, digits?: number): string {
  return String(value) + String(digits);
}

export class Registry {
  add(name: string): void;
  add(name: string, weight: number): void;
  add(name: unknown, weight?: number): void {}

  static of(seed: string): Registry;
  static of(seed: number): Registry;
  static of(seed: unknown): Registry {
    return new Registry();
  }
}

export function drive(): string {
  const r = Registry.of("a");   // overload 0
  const q = Registry.of(1);     // overload 1 — NOT the first
  r.add("x");                   // overload 0
  q.add("x", 2);                // overload 1 — NOT the first
  return format("s")            // overload 0
    + format(1, 2)              // overload 1 — NOT the first
    + format(true);             // overload 2 — NOT the first
}

// ── client -> library ────────────────────────────────────────────────────────
import { render, Codec } from "../lib/fmt";

export function useLibrary(): string {
  const c = new Codec();
  return render("s")        // library overload 0
    + render(1, 2)          // library overload 1 — NOT the first
    + render(false)         // library overload 2 — NOT the first
    + c.encode("a")         // library method overload 0
    + c.encode(3);          // library method overload 1 — NOT the first
}
