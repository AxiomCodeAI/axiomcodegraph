/**
 * The SHAPE of a type node.
 *
 * Positions 0–16 of `ts_type_reference` mirror `java_type_reference`, and this
 * enum starts from Java's `TypeRefKind` — but TypeScript's type system is where
 * the two languages diverge most, and most of these members have no Java
 * analogue at all.
 *
 * ## The measurement that shapes this enum
 *
 * In one ecosystem corpus: conditional types **2,174**, mapped **605**,
 * template-literal **161**, `infer` **1,337**, indexed-access **2,354**,
 * `keyof`/`readonly`/`unique` **3,030**, `typeof` **775**. That is 10,436 nodes
 * with no Java or Python counterpart. They live in this relation and in no
 * other, which is the structural guarantee that a conditional type can never
 * reach the call graph — there is simply no relation for it to be in.
 *
 * ## A union is N ROWS, never one row with a list
 *
 * `A | B | C` is one `UNION` row with `childCount = 3` plus three child rows
 * carrying `position` and `parentReferenceHash`. Measured union arity: p50 2,
 * p90 3, p99 7, **max 208**, with 45 nodes containing a nested union. A
 * comma-set column fails all three ways.
 *
 * `position` is SOURCE order. The checker normalises `boolean` into
 * `true | false` and reorders by type id, so `string | number | boolean` has
 * source order `[string, number, boolean]` and checker order
 * `[string, number, false, true]` — comparing member-wise against the checker
 * fails on correct output.
 *
 * ## Examples
 *
 * ```ts
 * User                      // TYPE_REFERENCE
 * string                    // PRIMITIVE
 * "active"                  // LITERAL          literalValue = "active"
 * T                         // TYPE_VARIABLE    (T is in scope as a type parameter)
 * User[]                    // ARRAY            → TYPE_ELEMENT: User
 * [string, number]          // TUPLE            → 2 TYPE_ELEMENT children
 * A | B                     // UNION            → 2 TYPE_ELEMENT children
 * A & B                     // INTERSECTION
 * (e: Event) => void        // FUNCTION_TYPE    → METHOD_PARAM, METHOD_RETURN
 * new () => C               // CONSTRUCTOR_TYPE
 * { a: string }             // TYPE_LITERAL     → TYPE_ELEMENT per member
 * T extends U ? A : B       // CONDITIONAL      → 4 children
 * { [K in keyof T]: T[K] }  // MAPPED
 * `/${string}`              // TEMPLATE_LITERAL
 * T["key"]                  // INDEXED_ACCESS   → 2 TYPE_ELEMENT children
 * typeof config             // TYPE_QUERY
 * keyof T                   // TYPE_OPERATOR
 * readonly T[]              // TYPE_OPERATOR    wildcardVariance = READONLY
 * unique symbol             // TYPE_OPERATOR    wildcardVariance = UNIQUE
 * infer U                   // INFER
 * x is Widget               // TYPE_PREDICATE
 * import("pkg").Thing       // IMPORT_TYPE
 * this                      // THIS_TYPE
 * (A | B)                   // PARENTHESIZED
 * [...T[]]                  // REST
 * [a?: string]              // OPTIONAL
 * [name: string]            // NAMED_TUPLE_MEMBER
 * intrinsic                 // INTRINSIC
 * ```
 *
 * Schema §4.5 c0, §3.3, §3.4.
 */
export enum TsTypeRefKind {
  /** A named type: `User`, `ns.Thing`, `Map<K, V>`. */
  TYPE_REFERENCE = 'TYPE_REFERENCE',

  /** A keyword type: `string`, `number`, `unknown`, `never`, `void`, `null`. */
  PRIMITIVE = 'PRIMITIVE',

  /** A literal type: `"active"`, `42`, `true`. 12,706 measured. */
  LITERAL = 'LITERAL',

  /** `T[]`. The element hangs off as a `TYPE_ELEMENT` child. */
  ARRAY = 'ARRAY',

  /** `[string, number]`. */
  TUPLE = 'TUPLE',

  /** `A | B`. N child rows, never a list. Max arity measured: 208. */
  UNION = 'UNION',

  /** `A & B`. */
  INTERSECTION = 'INTERSECTION',

  /** `(e: Event) => void`. Also gets a `ts_method` row: it is a real call target. */
  FUNCTION_TYPE = 'FUNCTION_TYPE',

  /** `new () => C`. */
  CONSTRUCTOR_TYPE = 'CONSTRUCTOR_TYPE',

  /** `{ a: string }` — an anonymous shape. 5,015 measured; no `ts_type` row. */
  TYPE_LITERAL = 'TYPE_LITERAL',

  /** `T extends U ? A : B`. 2,174 measured. */
  CONDITIONAL = 'CONDITIONAL',

  /** `{ [K in keyof T]: T[K] }`. 605 measured. */
  MAPPED = 'MAPPED',

  /** `` `/${string}` ``. 161 measured. */
  TEMPLATE_LITERAL = 'TEMPLATE_LITERAL',

  /** `T["key"]`. 2,354 measured. */
  INDEXED_ACCESS = 'INDEXED_ACCESS',

  /** `typeof config` in TYPE position — not the `typeof` operator. 775 measured. */
  TYPE_QUERY = 'TYPE_QUERY',

  /** `keyof T`, `readonly T[]`, `unique symbol`. 3,030 measured. */
  TYPE_OPERATOR = 'TYPE_OPERATOR',

  /** `infer U` inside a conditional. 1,337 measured. */
  INFER = 'INFER',

  /** `x is Widget` — 440 measured, and the engine's narrowing lever. */
  TYPE_PREDICATE = 'TYPE_PREDICATE',

  /** `import("pkg").Thing`. Carries `importSpecifier`. */
  IMPORT_TYPE = 'IMPORT_TYPE',

  /** `this` in a type position — polymorphic, and not the enclosing class. */
  THIS_TYPE = 'THIS_TYPE',

  /** `(A | B)` — punctuation preserved so source arity survives. */
  PARENTHESIZED = 'PARENTHESIZED',

  /** `[...T[]]` — a rest element in a tuple. */
  REST = 'REST',

  /** `[a?: string]` — an optional tuple element. */
  OPTIONAL = 'OPTIONAL',

  /** `[name: string]` — a labelled tuple element. */
  NAMED_TUPLE_MEMBER = 'NAMED_TUPLE_MEMBER',

  /**
   * A reference to a TYPE PARAMETER in scope, not to a declared type.
   *
   * Distinguished from `TYPE_REFERENCE` so the resolution layer does not chase
   * 42,032 phantom names: `T` inside `class Box<T>` names no declaration.
   */
  TYPE_VARIABLE = 'TYPE_VARIABLE',

  /** `intrinsic` — a compiler-implemented type such as `Uppercase<S>`. */
  INTRINSIC = 'INTRINSIC',
}
