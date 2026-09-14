// LIBRARY-DECLARED OVERLOAD SETS, MEETING IMPROVED ARGUMENT TYPING.
//
// Every regression this session came from the same collision: the engine learned to type
// an argument it could not type before, and the nominal pruning test then rejected the
// signature the compiler actually selects. The typing improvements were return
// inference, contextual callback parameters, mapped types and constrained type
// variables; this file is the other half of that collision, so the two are tested
// together rather than each alone.
//
// Declaration order is hostile throughout: the answer for the ordinary argument is never
// declaration 0.
export interface Row {
  readonly id: number;
}
export interface Cell {
  readonly value: string;
}

// (a) separated by PRIMITIVE — reached with an argument whose type is INFERRED from an
//     unannotated client function's return.
export function tag(v: boolean): string;
export function tag(v: number): string;
export function tag(v: string): string;
export function tag(v: unknown): string {
  return String(v);
}

// (b) separated by ARITY, with a CALLBACK in the longer form — reached with an arrow
//     whose parameter type comes from contextual typing.
export function each<T>(items: readonly T[]): number;
export function each<T>(items: readonly T[], fn: (item: T) => void): number;
export function each(items: readonly unknown[], fn?: unknown): number {
  return items.length;
}

// (c) separated by NAMED OBJECT TYPE — reached with an argument typed through a mapped
//     utility type, where the members are computed rather than declared.
export function shape(x: Cell): string;
export function shape(x: Row): number;
export function shape(x: unknown): unknown {
  return x;
}

// (d) separated by a CONSTRAINED type variable against a concrete sibling. This is the
//     pair that produced the regression: a constraint is a lower bound, so an argument
//     failing against the bound may still be a valid T.
export function widen<T extends Row>(x: T): T;
export function widen(x: string): string;
export function widen(x: unknown): unknown {
  return x;
}

// (e) a CLASS with an overloaded method, so the set is reached through a receiver type
//     rather than through an import binding.
export class Store {
  put(k: string, v: Row): void;
  put(k: string, v: Cell): void;
  put(k: string, v: unknown): void {}
}
