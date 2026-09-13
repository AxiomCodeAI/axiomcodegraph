/**
 * Which JSDoc tag this type tree hangs off. Schema §3.14 c7.
 *
 * `TEMPLATE` is the one that replaces a whole relation. `@template` appears
 * 624 times, and the schema's ruling is that a separate `js_type_parameter`
 * table for 624 comment-borne rows is not worth a table — so a type parameter
 * is a `js_type_reference` row with this context. That is a deliberate departure
 * from `ts_type_parameter` and it is recorded here so the absence reads as a
 * decision.
 */
export enum JsTypeReferenceContextKind {
  /** `@param {T} x`. 14,307 measured. */
  PARAM = 'PARAM',

  /** `@returns {T}`. 6,073 measured. */
  RETURN = 'RETURN',

  /** `@type {T}` on a variable. */
  VARIABLE = 'VARIABLE',

  /** `@type {T}` on a member. 8,869 `@type` tags in total. */
  FIELD = 'FIELD',

  /** `@typedef {T} Name` / `@callback Name`. The type being declared. */
  TYPEDEF = 'TYPEDEF',

  /** `@template T`. 624 measured, and the reason there is no separate relation. */
  TEMPLATE = 'TEMPLATE',

  /** `@this {T}` — the receiver's declared type, which nothing else can state. */
  THIS = 'THIS',

  /** `@extends {T}`. An inheritance edge asserted in a comment. */
  EXTENDS = 'EXTENDS',

  /** `@implements {T}`. JavaScript has no `implements`, so a comment is the only route. */
  IMPLEMENTS = 'IMPLEMENTS',

  /**
   * An inline JSDoc cast: `/** @type {T} *\/ (expr)` — the PARENTHESISED form,
   * which is the one the compiler treats as a type assertion.
   *
   * The position the vocabulary had no slot for. Every other context names a
   * DECLARATION position; a cast types an expression, so there was nothing to
   * emit for one — and 1,942 of 3,766 type-reference misses were exactly this.
   * 29.3% of all `@type` tags in JSDoc-typed code are casts, against 0.2% on a
   * variable declaration: in that style the cast is how a callback gets a type
   * at all. Owned by the EXPRESSION the parentheses wrap (§3.14.2), since a
   * parenthesis emits no row of its own.
   */
  CAST = 'CAST',

  /**
   * `@throws {T}` / `@exception {T}` on a callable. The closest JavaScript comes
   * to a throws clause, and it is a comment with no enforcement. Owned by the
   * METHOD it documents.
   */
  THROWS = 'THROWS',
}
