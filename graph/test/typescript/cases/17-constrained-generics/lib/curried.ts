// THE SHAPE THAT SLIPPED PAST THE GATE. Sixteen golden cases and five fixtures passed
// while the engine lost 592 exact answers on remeda, because none of them writes a
// library the way a data-first / data-last utility library is written:
//
//   * every signature constrained — `<T extends Container>`, `<K extends keyof T>`
//   * an overload SET per export, data-first and data-last, sharing one name
//   * one IMPLEMENTATION behind them all, with parameters wide enough to accept
//     anything the signatures accept
//
// That last property is what makes the case load-bearing. When argument typing improves
// enough for the nominal pruning test to start REJECTING the constrained signatures, the
// implementation is the only candidate left and the don't-empty safeguard hands it back
// — so the engine answers a declaration the compiler says is invisible to callers. The
// failure looks like better typing and reads as a regression only against a fixture
// shaped like this one.
export interface Container {
  readonly length: number;
}

export interface Named {
  readonly name: string;
}

// Data-first and data-last, separated by arity, both constrained.
export function pluck<T extends Named>(items: readonly T[], key: 'name'): string[];
export function pluck<T extends Named>(key: 'name'): (items: readonly T[]) => string[];
export function pluck(a: unknown, b?: unknown): unknown {
  return Array.isArray(a) ? a.map(() => '') : () => [];
}

// A constrained KEY parameter — `K extends keyof T` — which is how these libraries
// express property access. The engine must not use the constraint to reject the
// signature whose T is narrower than the bound.
export function at<T extends Container, K extends keyof T>(items: T, key: K): T[K];
export function at<T extends Container, K extends keyof T>(key: K): (items: T) => T[K];
export function at(a: unknown, b?: unknown): unknown {
  return b === undefined ? () => undefined : undefined;
}

// A constrained receiver whose member is guaranteed only by the bound.
export function widest<T extends Container>(items: readonly T[]): number;
export function widest<T extends Container>(): (items: readonly T[]) => number;
export function widest(a?: unknown): unknown {
  return Array.isArray(a) ? a.length : () => 0;
}
