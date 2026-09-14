/**
 * The syntactic shape of a decorator expression.
 *
 * The distinction that earns its place is `BARE` versus `CALL`: `@property` is
 * the decorator itself, while `@lru_cache(maxsize=None)` is a CALL whose RESULT
 * decorates. Only the second has arguments, and the arguments are where
 * framework semantics live — routes, permissions, cache sizes.
 *
 * `EXPRESSION` exists because PEP 614 (3.9) dropped the grammar restriction, so
 * `@buttons[0].clicked.connect` is legal and names no single identifier.
 *
 * Schema v7 §2.12 c1.
 */
export enum PythonDecoratorKind {
  /** `@property` — a plain name. */
  BARE = 'BARE',
  /** `@lru_cache(maxsize=None)` — a call whose result decorates. */
  CALL = 'CALL',
  /** `@app.route` — a dotted name, not called. */
  ATTRIBUTE = 'ATTRIBUTE',
  /** `@app.route("/x")` — the common framework shape. */
  ATTRIBUTE_CALL = 'ATTRIBUTE_CALL',
  /** `@registry["name"]`. */
  SUBSCRIPT = 'SUBSCRIPT',
  /** Any other expression, legal since PEP 614. */
  EXPRESSION = 'EXPRESSION',
}
