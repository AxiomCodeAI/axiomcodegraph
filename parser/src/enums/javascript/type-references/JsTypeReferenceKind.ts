/**
 * A node in a JSDoc type expression. Schema §3.14 c1.
 *
 * ## The JavaScript type system in its entirety, and it lives in comments
 *
 * `Array<Object<string, number>>` is **three rows**, not a string. The same
 * parent-FK tree shape `ts_type_reference` uses, capped at depth 32, because a
 * consumer that has to re-parse a string to find the generic argument is one
 * that will get it wrong on the first nested union.
 *
 * ## `UNKNOWN_SYNTAX` is deliberate and expected to be non-empty
 *
 * JSDoc type syntax is **not standardised**. Closure, TypeScript and jsdoc.app
 * all differ — on `!T`, on `Object<K,V>`, on `function(this:T, …)`. A type
 * expression the parser cannot decompose gets **one row with its text
 * preserved**, rather than a guess or a dropped tag. Guessing would put a
 * plausible wrong type into the fact base; dropping would lose the only
 * declared-type channel the language has.
 */
export enum JsTypeReferenceKind {
  /** `string`, `Foo`, `Bar.Baz`. A name. */
  NAMED = 'NAMED',

  /** `string|number`. Operands are children. */
  UNION = 'UNION',

  /** `A&B`. Rare in JSDoc and legal. */
  INTERSECTION = 'INTERSECTION',

  /** `string[]` or `Array<string>` written as an array shorthand. */
  ARRAY = 'ARRAY',

  /** `Array<T>`, `Object<K,V>`, `Promise<R>`. The name plus its arguments as children. */
  GENERIC_APPLICATION = 'GENERIC_APPLICATION',

  /**
   * `function(string): number`.
   *
   * A callable **shape**, and therefore the row most likely to be mistaken for a
   * call target. `isTypeOnly` is true — as it is for every row here — and the
   * gate asserts no `js_call_site` resolves into this relation.
   */
  FUNCTION_TYPE = 'FUNCTION_TYPE',

  /** `{a: string, b: number}` — an inline record shape. */
  OBJECT_TYPE = 'OBJECT_TYPE',

  /** A literal in type position: `'get'|'post'`, `42`. */
  TYPE_LITERAL = 'TYPE_LITERAL',

  /** `?T` — nullable, in Closure's spelling. */
  NULLABLE = 'NULLABLE',

  /** `!T` — explicitly non-nullable, in Closure's spelling. */
  NON_NULLABLE = 'NON_NULLABLE',

  /** `T=` or `[x]` — an optional parameter. */
  OPTIONAL = 'OPTIONAL',

  /** `...T` — a rest parameter's element type. */
  REST = 'REST',

  /** `*` or `any`. Declared, and declaring nothing. */
  ANY = 'ANY',

  /**
   * `import("./x").Y` — JavaScript's `import type`, written in a comment.
   *
   * Schema §3.14.4. The qualifier (`Y`) is the row's `typeName`; the
   * specifier is a `js_import` row with `isTypeOnly = true`, reached through
   * `importLinkHash`, because a typedef whose file the engine cannot locate is
   * the incomplete row §0.2 forbids. Type arguments are children. 3,718 of these
   * sat under UNKNOWN_SYNTAX with their text intact and their hop absent.
   */
  IMPORT_TYPE = 'IMPORT_TYPE',

  /** `[number, number]`. Elements are children, in order. */
  TUPLE = 'TUPLE',

  /** `T['key']`. The object type and the index type are the two children. */
  INDEXED_ACCESS = 'INDEXED_ACCESS',

  /** `typeof x` — the type of a value. The name is the expression as written. */
  TYPE_QUERY = 'TYPE_QUERY',

  /**
   * `x is string` / `asserts x is T`. Arrives as the return of a
   * FUNCTION_TYPE; the asserted type is the child, the name is the parameter.
   */
  TYPE_PREDICATE = 'TYPE_PREDICATE',

  /** Text the parser could not decompose. Preserved verbatim, never guessed. */
  UNKNOWN_SYNTAX = 'UNKNOWN_SYNTAX',
}
