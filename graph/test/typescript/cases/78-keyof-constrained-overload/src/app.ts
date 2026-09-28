import type { Bus } from '../lib/bus';

// WHAT THIS CASE PINS. A generic overload whose parameter is `K extends keyof X`, beside
// a widening `string` sibling. The compiler takes the generic when the argument is a
// string literal that IS a key of X, and the `string` one otherwise. The engine used to
// take `string` at every site, because the literal matched `string` and matched nothing
// concretely in `K` (#334).

export function viaKey(b: Bus): void {
  b.emit('open');
}

export function viaMethodKey(b: Bus): void {
  b.run('start');
}

// Control: a literal that is NOT a key — only `emit(string)` applies.
export function viaNonKey(b: Bus): void {
  b.emit('other');
}

// Control: a general string is not a keyof — `emit(string)`.
export function viaString(b: Bus, t: string): void {
  b.emit(t);
}

// Control: the widening signature is declared FIRST, so it wins even for a key.
export function viaWideningFirst(b: Bus): void {
  b.pick('open');
}

// The same shape declared in CLIENT code, on a class with an implementation.
interface Slots { a: number; b: string; }

class Registry {
  get<K extends keyof Slots>(k: K): Slots[K];
  get(k: string): unknown;
  get(k: string | number): unknown { return k; }
}

export function viaClassKey(r: Registry): unknown {
  return r.get('a');
}

// Control: not a key of Slots.
export function viaClassNonKey(r: Registry): unknown {
  return r.get('zzz');
}
