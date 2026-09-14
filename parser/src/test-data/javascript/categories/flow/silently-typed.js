/* @flow */
// fixture: flow/silently-typed.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — every function below has a body and runs, once the
//   annotations are stripped by Flow's build step.
// expected provenance: FLOW_REJECTED — and if it is ever PROJECT again, 28 SYNTACTIC_FLOW parameters come back with zero diagnostics to find them by
// syntax floor: Flow type annotations, from flow.org/en/docs/types
//
// THE SILENT POPULATION. Every annotation in this file parses under
// `ScriptKind.JS` with **ZERO diagnostics**, and every one of them is Flow.
// There is no TypeScript here and there cannot be: this is a `.js` file.
//
// This is the 3,793-parameter case, and it is the one that cannot be found by
// counting parse gaps — because it produces none. A corpus sweep that measures
// Flow by its diagnostics sees the loud half (exact objects, variance sigils,
// casts) and is structurally incapable of seeing this half at all.
//
// ## A correction to how the population was described to me
//
// The brief grouped "exact object types, variance sigils, opaque types,
// `$ReadOnly` and friends" together as silently accepted. **Measured, they
// split**, and the split is the whole point:
//
//   | construct                      | diagnostics under ScriptKind.JS |
//   |--------------------------------|---------------------------------|
//   | `$ReadOnly<T>` and friends     | 0  — silent, this file           |
//   | `mixed`, `empty`               | 0  — silent, this file           |
//   | `?T` maybe types               | 0  — silent, this file           |
//   | `{ [string]: number }` indexer | 0  — silent, this file           |
//   | `Array<*>` existential         | 0  — silent, this file           |
//   | `interface` / `implements`     | 0  — silent, declare-statements.js |
//   | exact object `{| |}`           | 4  — LOUD, recovery-mangling.js  |
//   | variance sigil `+x`            | 3  — LOUD, recovery-mangling.js  |
//   | `opaque type`                  | 1  — LOUD, recovery-mangling.js  |
//   | type-param bound `<T: B>`      | 1  — LOUD, recovery-mangling.js  |
//
// So the silent set is BIGGER and DIFFERENT from the one named, and it includes
// the whole ambient-declaration family. Recording that split is worth more than
// either fixture on its own.
//
// ## What makes these Flow and not TypeScript
//
// Every type named below is either Flow-only (`mixed`, `empty`, `$Keys`,
// `$ObjMap`, the existential `*`) or means something DIFFERENT in Flow than the
// identically-spelled TypeScript. `mixed` is Flow's `unknown`; TypeScript has no
// `mixed`, so a TypeScript-shaped reader records a reference to a nominal type
// named "mixed" that resolves to nothing, in a language that has no nominal
// types. The row is syntactically well-formed and semantically empty.
//
// ## It discriminates under all three rulings
//
//   distinct scriptKind — parsed as Flow, `declaredTypeSource = SYNTACTIC_FLOW`
//   explicit rejection  — zero rows; the parameter names below appear nowhere else
//   emit-with-residual  — rows minted with NO diagnostic anywhere, so
//                         `declaredTypeSource` is the only column that can say
//                         these are Flow. If it says anything else, a JavaScript
//                         fact base is asserting TypeScript annotations.


// --- Flow's top and bottom types --------------------------------------------------
//
// `mixed` is the supertype of everything and requires refinement before use.
// `empty` is the bottom type, inhabited by nothing. Neither exists in TypeScript.

export function describe(value: mixed): string {
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number') { return String(value); }
  return 'unknown';
}

export function unreachable(x: empty): empty {
  throw new Error('unreachable');
}

// --- maybe types ---------------------------------------------------------------------
//
// `?T` is `T | null | void`. TypeScript spells that `T | null | undefined` and
// has no prefix form, yet `?T` draws no diagnostic here.

export function trim(input: ?string): string {
  return input == null ? '' : input.trim();
}

export function pick(items: ?Array<?number>): number {
  return (items && items[0]) || 0;
}

// --- the $-prefixed utility types ---------------------------------------------------
//
// Every one of these is a Flow builtin. They parse as ordinary generic type
// references because `$Foo` is a legal identifier, so nothing marks them.

export function keysOf(source: $Keys<{ a: number, b: string }>): string {
  return String(source);
}

export function readOnly(config: $ReadOnly<{ host: string }>): string {
  return config.host;
}

export function partial(patch: $Shape<{ a: number, b: string }>): Object {
  return { ...patch };
}

export function exactly(value: $Exact<{ a: number }>): Object {
  return value;
}

export function valuesOf(v: $Values<{ a: number }>): mixed { return v; }
export function nonMaybe(v: $NonMaybeType<?string>): string { return v; }
export function elementOf(v: $ElementType<Array<number>, number>): number { return v; }
export function propertyOf(v: $PropertyType<{ a: number }, 'a'>): number { return v; }
export function difference(v: $Diff<{ a: number, b: string }, { b: string }>): Object { return v; }
export function called(v: $Call<() => number>): number { return v; }
export function mapped(v: $ObjMap<{ a: number }, <V>(V) => V>): Object { return v; }
export function tupleMapped(v: $TupleMap<[number], <V>(V) => V>): Object { return v; }
export function rest(v: $Rest<{ a: number }, { }>): Object { return v; }

// --- the existential type -----------------------------------------------------------
//
// `*` tells Flow to infer. It is a legal TypeScript token only inside a JSDoc
// type expression, and here it is in a syntactic annotation, silently.

export function anyElement(items: Array<*>): number {
  return items.length;
}

// --- indexer properties ----------------------------------------------------------------
//
// `{ [string]: number }` has an UNNAMED index key. TypeScript requires
// `{ [k: string]: number }` and rejects the unnamed form in a type literal —
// but not here.

export function total(counts: { [string]: number }): number {
  return Object.keys(counts).reduce((sum, k) => sum + counts[k], 0);
}

export function lookup(table: { [key: string]: ?Array<mixed> }, k: string): mixed {
  return table[k];
}

// --- Flow's unsafe escape hatches ----------------------------------------------------
//
// `any` and `Object` and `Function` all exist in TypeScript with different
// meanings and different strictness. Identical spelling, different language.

export function unsafe(value: any): Object {
  return value;
}

export function callAnything(fn: Function, arg: mixed): mixed {
  return fn(arg);
}

// --- a class whose every member is silently annotated ---------------------------------

export class Store {
  cache: { [string]: mixed };
  size: number;
  fallback: ?Store;

  constructor(size: number) {
    this.cache = {};
    this.size = size;
    this.fallback = null;
  }

  get(key: string): mixed {
    return this.cache[key];
  }

  set(key: string, value: mixed): Store {
    this.cache[key] = value;
    return this;
  }
}
