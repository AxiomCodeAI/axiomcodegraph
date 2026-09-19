// Destructuring a for-of over a Map bound NOTHING, so every call on the loop value was
// unresolved — while the same loop over a Set, or over an array of written tuples,
// resolved. That read as a for-of defect and is not one: `Map<K, V>` iterates as
// `[K, V]`, and the type arguments THE CLIENT WRITES are positionally that tuple.
//
// WHICH IS WHY THIS CASE NEEDS NO LIBRARY. Nothing here asks what `Map` declares; the
// rule reads the annotation's own children, so the assertion is client-only and this
// file is real evidence rather than a neighbour. `map.values()` is the other half of
// #433 and does need the library — case 66.
//
// KEY AND VALUE ARE DIFFERENT CLASSES ON PURPOSE. A rule that read type argument 0 for
// every destructured position would answer `Key#id` for the value line too, and with one
// class the two would be indistinguishable. Scoring compares (caller, callee) pairs, so
// the wrong-position answer has to be a different pair to be catchable at all.
export class Key { id(): number { return 1; } }
export class Val { use(): number { return 2; } }

// THE CASE: the VALUE, at index 1.
export function viaMapValue(m: Map<Key, Val>): number {
  let n = 0;
  for (const [, v] of m) { n += v.use(); }
  return n;
}

// THE CASE: the KEY, at index 0 — the position discriminator.
export function viaMapKey(m: Map<Key, Val>): number {
  let n = 0;
  for (const [k] of m) { n += k.id(); }
  return n;
}

// Both positions bound in one destructure.
export function viaBothPositions(m: Map<Key, Val>): number {
  let n = 0;
  for (const [k, v] of m) { n += k.id() + v.use(); }
  return n;
}

// The readonly view iterates identically.
export function viaReadonlyMap(m: ReadonlyMap<Key, Val>): number {
  let n = 0;
  for (const [, v] of m) { n += v.use(); }
  return n;
}

// CONTROL: a Set iterates as ONE element, not a tuple. If the new rule leaked into the
// single-element containers this would start answering the wrong thing.
export function ctlSet(s: Set<Val>): number {
  let n = 0;
  for (const v of s) { n += v.use(); }
  return n;
}

// CONTROL: an array of WRITTEN tuples — #442's route, which walks a real TUPLE
// reference. The two rules must not be the same rule.
export function ctlTupleArray(pairs: [Key, Val][]): number {
  let n = 0;
  for (const [, v] of pairs) { n += v.use(); }
  return n;
}

// CONTROL: a plain array element, the oldest of these routes.
export function ctlArray(vs: Val[]): number {
  let n = 0;
  for (const v of vs) { n += v.use(); }
  return n;
}

export function main(m: Map<Key, Val>, rm: ReadonlyMap<Key, Val>, s: Set<Val>,
                     pairs: [Key, Val][], vs: Val[]): number {
  return viaMapValue(m) + viaMapKey(m) + viaBothPositions(m) + viaReadonlyMap(rm)
       + ctlSet(s) + ctlTupleArray(pairs) + ctlArray(vs);
}
