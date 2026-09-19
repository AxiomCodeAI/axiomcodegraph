// `if (isSpecial(i)) i.boost()` — a type predicate called as a guard. The narrowing
// forms the engine already modelled were the two `asserts` spellings and `instanceof` on
// a TOP-typed subject; the plainest and commonest one, a user-defined guard in an `if`,
// was not modelled, so the guarded call answered the UNNARROWED declaration. Where the
// narrowed type declares a member the declared type does not, the site was unresolved;
// where both declare it, the engine committed a single confident edge to the wrong one,
// which is what issue #427 measured on the standard library's `Array.isArray`.
//
// WHAT THIS CASE CAN AND CANNOT SAY. The client half — `isSpecial` below — is complete
// evidence: no library is involved. The library half is the MECHANISM through an import,
// not `lib.es5.d.ts`'s own line; a case's `lib/` is a client-authored second tree (case
// 41 states this). The standard library's `Array.isArray` is measured on the corpus.
//
// FLOW-INSENSITIVE BY CONSTRUCTION, so `ctlUnguarded` keeps the declared answer and the
// guarded sites gain a second candidate rather than trading one for another. The
// unguarded control is in its OWN function for that reason: a control sharing a function
// with a guard would legitimately see both.
import { ReadonlySlots, Slots, isSlots } from "../lib/guards";

export class Item { run(): number { return 1; } }
export class Special extends Item { boost(): number { return 2; } }

// THE CASE, client-only: a predicate declared and called in the client.
export function viaClientGuard(i: Item): number {
  if (isSpecial(i)) { return i.boost(); }
  return i.run();
}
export function isSpecial(i: Item): i is Special {
  return i instanceof Special;
}

// THE CASE: the guard is an `&&` operand rather than an `if` condition. Same predicate,
// a different syntactic position — #427 measured both and they must not diverge.
export function viaAndOperand(i: Item): number {
  return isSpecial(i) && i.boost() > 0 ? 1 : 0;
}

// THE CASE: a LIBRARY predicate narrowing to a library interface. `mutate` is declared
// only on `Slots`, so this call is unreachable without the narrowing.
export function viaLibraryGuard(ro: ReadonlySlots<Item>): void {
  if (isSlots(ro)) { ro.mutate(new Item()); }
}

// THE CASE: a predicate whose SUBJECT IS ITS SECOND ARGUMENT, matched by name rather
// than by index.
export function isSecondSpecial(tag: string, i: Item): i is Special {
  return tag === "special" && i instanceof Special;
}
export function viaSecondArgument(i: Item): number {
  if (isSecondSpecial("special", i)) { return i.boost(); }
  return i.run();
}

// CONTROL: the declared type, in a function with no guard in it at all.
export function ctlUnguarded(i: Item, ro: ReadonlySlots<Item>): number {
  ro.peek();
  return i.run();
}

// CONTROL: a plain boolean-returning function is NOT a predicate and must narrow
// nothing. If this starts answering `Special#boost`, the rule is firing on any call
// whose argument is a parameter.
export function looksLikeAGuard(i: Item): boolean {
  return i instanceof Special;
}
export function ctlPlainBoolean(i: Item): number {
  if (looksLikeAGuard(i)) { return i.run(); }
  return 0;
}

export function main(i: Item, s: Special, ro: ReadonlySlots<Item>): number {
  viaLibraryGuard(ro);
  return viaClientGuard(i) + viaAndOperand(s) + viaSecondArgument(s)
       + ctlUnguarded(i, ro) + ctlPlainBoolean(i);
}
