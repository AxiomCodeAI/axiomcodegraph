// ============================================================================
// CASE 22 — `call` / `apply` / `bind` on a callable value, LOOSE regime
// ============================================================================
// THE SAME CLIENT CODE AS CASE 21. The only difference between the two cases is
// src/tsconfig.json, and that difference changes which declaration the compiler
// answers with at every site below:
//
//   case 21   strict: true                              -> CallableFunction  lib.es5.d.ts:348/341/363
//   case 22   strict: false, strictBindCallApply: false  -> Function          lib.es5.d.ts:286/279/294
//
// lib.es5.d.ts declares `call`, `apply` and `bind` on `Function` and again on
// `CallableFunction extends Function`. `strictBindCallApply` picks the set. It is not
// a style option and it is not cosmetic: it decides the ANSWER.
//
// WHY THIS CASE IS THE IMPORTANT ONE. An engine can seed a callable value's members and
// still be wrong here, by committing to CallableFunction's declarations because "every
// project sets strict". Projects that set individual strict flags instead do not, and
// this case is that project. Issue #142's +19 wrong answers were all this shape.
//
// WHAT IT DISCRIMINATES, precisely:
//   rule absent                     -> every site MISSED (the original defect)
//   rule present, regime ignored    -> every site WRONG: CallableFunction's declaration
//                                      named where the compiler chose Function's
//   rule present, regime honoured   -> EXACT
// Case 21 passes under both of the last two, so it cannot detect the middle failure.
// This case can, and that is why the fixture is a PAIR.

// Everything this case needs is in this directory. `src/globals.d.ts` declares
// `Function` and `CallableFunction`; `src/tsconfig.json` sets `noLib` so those are the
// ONLY declarations of them in the program, on both sides of the comparison.

interface Transformer {
  (input: string): string;
}

class Registry {
  lookup(key: string): string {
    return key;
  }
}

// ── 1. a declared function referenced as a value ────────────────────────────
function localFormat(value: string, width: number): string {
  return value.padEnd(width);
}

export function viaDeclaredFunction(): string {
  const bound = localFormat.bind(null, 'a');
  localFormat.call(null, 'b', 2);
  localFormat.apply(null, ['c', 3]);
  return bound(4);
}

// ── 2. a parameter of function type ─────────────────────────────────────────
// No declaration to point at: the receiver's type is a SHAPE, and a shape is a
// signature — parameters and a return, no members. This is the site class that made
// `member_absent` the diagnosis.
export function viaParameter(fn: (a: number) => number, t: Transformer): number {
  t.call(null, 'q');
  t.bind(null);
  return fn.call(null, 1) + fn.apply(null, [2]);
}

// ── 3. an arrow stored in a variable ────────────────────────────────────────
const arrow = (a: number, b: number): number => a + b;

export function viaArrow(): number {
  arrow.apply(null, [1, 2]);
  const half = arrow.bind(null, 1);
  return arrow.call(null, 3, 4) + half(5);
}

// ── 4. a method reference ───────────────────────────────────────────────────
export function viaMethodReference(r: Registry): string {
  const m = r.lookup;
  m.call(r, 'k');
  return m.bind(r)('j');
}

// ── 5. the CONTROL — an object type literal must gain NOTHING ───────────────
// `callable` means "has a call signature", not "has a shape". A shape includes an
// object type literal, and giving `{ a: number }` a `.bind` would manufacture a wrong
// answer where there was none. The compiler reports no member here, and so must the
// engine: this site is expected to stay unresolved.
export function objectLiteralGainsNothing(o: { a: number }): number {
  return o.a;
}

// ── 6. the OTHER control — a type with its OWN `bind` keeps it ──────────────
// Shadowing, for the same reason Object's members are shadowed: a declaration that
// declares the name wins, rather than going multi-candidate across two unrelated
// declarations.
interface OwnBind {
  (x: number): number;
  bind(label: string): string;
}

export function ownBindWins(ob: OwnBind): string {
  return ob.bind('own');
}

