// ============================================================================
// CASE 21 — `call` / `apply` / `bind` on a callable value, STRICT regime
// ============================================================================
// These three are not members of a function's signature. They are declared on the
// global `Function` interface in lib.es5.d.ts and AGAIN on `CallableFunction extends
// Function`, and `strictBindCallApply` is the only thing that decides which set the
// compiler answers with. This case sets `strict: true` in src/tsconfig.json, so the
// resolved flag is true (the checker computes `strictBindCallApply ?? strict ?? false`;
// `ts.parseJsonConfigFileContent` does NOT apply that implication, which is why the
// parser emits the flag RESOLVED at ts_module c27) and every site below resolves to
// CallableFunction's precise generic signatures.
//
// Case 22 is this file with one option changed. Verified against the compiler:
//   strict: true                              -> CallableFunction  lib.es5.d.ts:348/341/363
//   strict: false, strictBindCallApply: false  -> Function          lib.es5.d.ts:286/279/294
//
// WHAT IT DISCRIMINATES. With the rule removed, a callable receiver has no members at
// all and every site here is MISSED — that is the defect the case exists for. With the
// rule present but the REGIME ignored (committing to CallableFunction unconditionally,
// as the first draft did), this case still passes and case 22 fails. Neither case alone
// is sufficient; the pair is the test.

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
  bind(this: void, label: string): string;
}

export function ownBindWins(ob: OwnBind): string {
  return ob.bind('own');
}

