/* @flow */
// fixture: flow/recovery-mangling.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing in intent — but see below, because what the parser
//   produces from this file is not what the file says.
// expected provenance: FLOW_REJECTED — and if it is ever PROJECT again, 63 statements from ~25 written come back, four of them detached Blocks
// syntax floor: Flow syntax with no TypeScript equivalent, from
//   flow.org/en/docs/types/objects, /variance, /opaque-types and /libdefs
//
// THE LOUD HALF, and the finding is not the diagnostics — it is what recovery
// leaves behind. Measured per construct under `ScriptKind.JS`:
//
//   | one source statement                     | diags | statements produced |
//   |------------------------------------------|-------|---------------------|
//   | `type T = { +x: number };`                |   3   | TypeAlias, Expression, Expression, Empty |
//   | `opaque type Id = string;`                |   1   | Expression, TypeAlias |
//   | `declare opaque type Token: string;`      |   2   | Expression, Expression, TypeAlias, Expression |
//   | `declare module.exports: {...};`          |   1   | Expression, Expression, **Block**, Empty |
//   | `declare class E { +p: T; }`              |   4   | Class, Expression, Expression |
//   | `function f(x): boolean %checks {...}`    |   2   | Function, Expression, **Block** |
//   | `import typeof T from "./m";`             |   1   | Import, Expression, Expression |
//
// **One statement in, four out.** Recovery does not skip the construct it cannot
// parse — it re-enters the statement grammar mid-expression and manufactures
// statements that are in no source line, including detached `Block`s that will
// be walked as if they were real blocks and `ExpressionStatement`s whose
// identifiers will be resolved as if they were real reads.
//
// That is a different failure from a missing row. A parse gap says something is
// absent; this produces rows that are PRESENT and describe nothing. They are
// correctly positioned, so they are invisible to recall, to completeness and to
// every count-based check — §4's defect class, arriving through the parser's
// error path rather than through a classification bug.
//
// ## It discriminates under all three rulings
//
//   distinct scriptKind — a Flow parser produces one statement per statement and
//                         none of the phantoms below exist
//   explicit rejection  — zero rows, and the phantoms cannot be minted
//   emit-with-residual  — the phantom statements ARE the residual, and the
//                         question this file asks is whether anything marks them.
//                         A gap at the diagnostic's position does not cover the
//                         invented `Block` three tokens later.


// --- variance sigils: read-only and write-only properties -------------------------
//
// `+` covariant, `-` contravariant. Flow's spelling for readonly-ness, and there
// is no TypeScript form, so the object type is torn in half.

type Point = { +x: number, +y: number };
type Sink = { -value: string };
type Both = { +ro: number, -wo: string, rw: boolean };

// --- variance on class properties -------------------------------------------------

declare class Frozen {
  +readOnlyProp: number;
  -writeOnlyProp: string;
}

// --- exact object types ------------------------------------------------------------
//
// `{| |}` means no extra properties. TypeScript has no exact-object syntax at
// all, so both delimiters are unparseable and the recovery is the widest here.

type ExactPoint = {| x: number, y: number |};
type ExactNested = {| inner: {| deep: string |} |};

export function takesExact(p: {| a: number |}): number {
  return p.a;
}

// --- opaque types ---------------------------------------------------------------------
//
// Flow's nominal escape hatch: outside this file `UserId` is not a string.
// `opaque` is not a TypeScript keyword, so it is parsed as an identifier and
// becomes an expression statement of its own.

opaque type UserId = string;
opaque type Meters: number = number;

declare opaque type Token: string;

// --- type-parameter bounds ---------------------------------------------------------------
//
// Flow writes `<T: Base>`; TypeScript writes `<T extends Base>`. The colon is
// the whole difference and it is a syntax error.

export function firstOf<T: { id: string }>(items: Array<T>): T {
  return items[0];
}

declare class Container<T: Object> {
  get(): T;
}

// --- predicate functions -------------------------------------------------------------------
//
// `%checks` marks a function as a type refinement. The `%` sends recovery into
// the statement grammar and the function's real body becomes a DETACHED BLOCK.

export function isString(x: mixed): boolean %checks {
  return typeof x === 'string';
}

// --- object type spread and the module.exports declaration ------------------------------------

type Base = { a: number };
type Spread = { ...Base, b: number };
type ExactSpread = {| ...Base, +c: string |};

declare module.exports: { takesExact: typeof takesExact };

// --- import typeof, which has no TypeScript spelling --------------------------------------------

import typeof StoreClass from './silently-typed.js';

// --- the control: valid JavaScript that recovery must NOT touch -----------------------------------
//
// Nothing below is Flow. If any of it acquires a diagnostic or a phantom
// statement, the recovery from the constructs above has run past its construct.

export const plainObject = { x: 1, y: 2 };
export function plainFunction(a, b) { return a + b; }
export class PlainClass { constructor() { this.ok = true; } }
