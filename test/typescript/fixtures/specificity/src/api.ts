// GENERIC-FIRST OVERLOAD SETS — the shape that produced 1,272 of the corpus's 3,508
// wrong answers, reproduced from the LANGUAGE RULE rather than from any project.
//
// The pattern: a library declares its generic overload FIRST and its concrete ones
// after. Vue's `h` does it, remeda's data-last pairs do it, and it is idiomatic rather
// than unusual. An engine whose applicability test cannot evaluate a type parameter's
// constraint finds the first declaration unconditionally applicable and, taking the
// first applicable, answers it every time.
//
// THE POINT OF THIS FILE IS THAT THE ANSWER GOES BOTH WAYS. Any rule that fixes the
// second case by demoting generics breaks the first, and this fixture is what makes
// that visible before the rule ships rather than after.

export interface Widget {
  readonly kind: 'widget';
}

export interface TagMap {
  div: 'div-element';
  span: 'span-element';
}

// ── SET 1: the generic overload is declared first and is SOMETIMES the answer ───
// `render('div')` -> #0, because 'div' satisfies `keyof TagMap`.
// `render(widget)` -> #1, because a Widget does not.
// Both calls are below. An engine that always takes #0 gets the first right and the
// second wrong; one that always demotes #0 does the exact opposite.
export function render<K extends keyof TagMap>(target: K): string;
export function render(target: Widget): string;
export function render(target: unknown): string {
  return String(target);
}

// ── SET 2: the constraint is a TYPE VARIABLE, so nothing about it is testable ───
// `pick(box, other)` cannot be separated from `pick(box)` by any test the engine can
// perform on the constraint alone. The honest answer here is the SET, and an engine
// that names one confidently is manufacturing the answer from declaration order.
// SAME ARITY on both, so nothing but the constraint can separate them — and the
// constraint is `T`, which is itself a type variable. This is remeda's `isDeepEqual`
// shape, where the compiler chose the SECOND declaration 48 times and the engine the
// first every time.
export function pick<T, S extends T>(value: T, fallback: S): S;
export function pick<T>(value: T, fallback: T): T;
export function pick<T>(value: T, fallback: T): T {
  return value ?? fallback;
}

// ── SET 3: DATA-FIRST / DATA-LAST, the remeda shape ────────────────────────────
// Separated by arity AND by whether argument 1 is callable. Both tests are decidable
// without evaluating a constraint, so this set is the control: an engine that gets
// SET 1 and SET 2 wrong can still get this right, which tells the three apart.
export function pluck<T>(items: readonly T[], select: (item: T) => string): string[];
export function pluck<T>(select: (item: T) => string): (items: readonly T[]) => string[];
export function pluck<T>(a: unknown, b?: unknown): unknown {
  return Array.isArray(a) ? a.map(b as (item: T) => string) : (items: readonly T[]) => items;
}

// ── SET 4: a lower-indexed candidate that is DEMONSTRABLY inapplicable ─────────
// A primitive mismatch the engine already tests. Declaration order must still work
// here: standing down on every overload set would lose this one, and it is the case
// that says a stand-down rule was scoped rather than blanket.
export function widen(value: string): string;
export function widen(value: number): number;
export function widen(value: string | number): string | number {
  return value;
}
