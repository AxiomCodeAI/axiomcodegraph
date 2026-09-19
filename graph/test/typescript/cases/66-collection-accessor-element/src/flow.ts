// `for (const v of registry.values())` — the accessor resolves, and its ELEMENT did not.
// The call itself was never in question: `values()` named the right declaration all
// along. What was missing is the substitution of the receiver's type argument into the
// ITERATOR the accessor returns, so the loop variable had no type and every call on it
// was unresolved. Issue #433.
//
// KEYS AND VALUES RETURN DIFFERENT CLASSES ON PURPOSE, as in case 65: `keys()` is
// `MapIterator<K>` and `values()` is `MapIterator<V>`, so a rule that substituted type
// argument 0 of the RECEIVER instead of the one the accessor names would answer `Key`
// for both and could not be told from a correct answer.
import { Registry, Bag, Slots } from "../lib/collections";

export class Key { id(): number { return 1; } }
export class Val { use(): number { return 2; } }

// THE CASE: MapIterator<V>.
export function viaValues(r: Registry<Key, Val>): number {
  let n = 0;
  for (const v of r.values()) { n += v.use(); }
  return n;
}

// THE CASE: MapIterator<K> — the discriminator.
export function viaKeys(r: Registry<Key, Val>): number {
  let n = 0;
  for (const k of r.keys()) { n += k.id(); }
  return n;
}

// THE CASE: SetIterator<T>.
export function viaSetIterator(b: Bag<Val>): number {
  let n = 0;
  for (const v of b.values()) { n += v.use(); }
  return n;
}

// THE CASE: ArrayIterator<T>.
export function viaArrayIterator(s: Slots<Val>): number {
  let n = 0;
  for (const v of s.values()) { n += v.use(); }
  return n;
}

// CONTROL: `entries()` yields a TUPLE, which has no declaration to name, so the element
// resolving to NOTHING is the correct answer here and not a gap. Kept so that a later
// change which starts answering something for it has to say what.
export function ctlEntriesTuple(r: Registry<Key, Val>): number {
  let n = 0;
  for (const pair of r.entries()) { n += pair.length; }
  return n;
}

// CONTROL: the accessor call itself, which resolved before this fix and must still. If
// this one breaks, the element rule is being blamed for a callee-resolution regression.
export function ctlAccessorCall(r: Registry<Key, Val>): void {
  r.values();
}

export function main(r: Registry<Key, Val>, b: Bag<Val>, s: Slots<Val>): number {
  ctlAccessorCall(r);
  return viaValues(r) + viaKeys(r) + viaSetIterator(b) + viaArrayIterator(s)
       + ctlEntriesTuple(r);
}
