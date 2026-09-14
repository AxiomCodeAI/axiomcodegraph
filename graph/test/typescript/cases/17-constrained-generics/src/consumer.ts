// Every call must land on an overload SIGNATURE. An answer of the implementation is
// wrong even though it is the declaration that carries the body — the compiler makes it
// invisible to callers, and naming it sends a reader to code the call does not select.
import { pluck, at, widest, Container, Named } from "../lib/curried";

interface Row extends Named, Container {
  readonly length: number;
  readonly name: string;
  readonly id: number;
}

const rows: readonly Row[] = [];

export function dataFirst(): string[] {
  return pluck(rows, 'name');            // signature #0, arity 2
}

export function dataLast(): (items: readonly Row[]) => string[] {
  return pluck('name');                  // signature #1, arity 1
}

export function keyedFirst(row: Row): number {
  return at(row, 'id');                  // at #0 — K is 'id', narrower than keyof Row
}

export function keyedLast(): (items: Row) => string {
  return at('name');                     // at #1
}

export function widestFirst(): number {
  return widest(rows);                   // widest #0
}

export function widestLast(): (items: readonly Row[]) => number {
  return widest();                       // widest #1
}

// A constrained TYPE PARAMETER as a receiver, in the client's own code: `t.length` is
// guaranteed by the bound and by nothing else. This is the capability the reverted hop
// restores, and it belongs beside the population that reverting it protects.
export function ownConstraint<T extends Container>(t: T): number {
  return t.length;
}

export function ownConstraintNamed<T extends Named>(t: T): string {
  return t.name.toUpperCase();
}

// ── the same set, declared in the CLIENT ────────────────────────────────────
// This half is the one that matters for the regression: remeda declares its utilities
// in its own source, so the wrong answers were client->client. Every call here must land
// on a SIGNATURE; the implementation is invisible to callers and naming it is wrong.
import { pluck as lpluck, at as lat, widest as lwidest } from "./curried-local";

export function localDataFirst(): string[] {
  return lpluck(rows, 'name');           // local signature #0
}
export function localDataLast(): (items: readonly Row[]) => string[] {
  return lpluck('name');                 // local signature #1
}
export function localKeyed(row: Row): number {
  return lat(row, 'id');                 // local at #0
}
export function localWidest(): number {
  return lwidest(rows);                  // local widest #0
}
