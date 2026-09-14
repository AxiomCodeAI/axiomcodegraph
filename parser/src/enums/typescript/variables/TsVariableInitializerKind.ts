/**
 * The shape of a variable's initializer.
 *
 * ## Two members carry the whole reason this column exists
 *
 * `ARROW` and `FUNCTION_EXPRESSION` are what `boundFunctionLinkHash` keys off:
 *
 * ```ts
 * const f = () => { … };
 * f();                       // resolves through the VARIABLE, not by name
 * ```
 *
 * **161 measured call targets are arrow functions**, and an arrow has no name a
 * call site could match — the variable is the only route to it. Java never needed
 * this link; Python folded the equivalent into `py_binding`.
 *
 * `NEW` and `CALL` are the next most useful: an initializer that constructs
 * names its type as plainly as an annotation would, which is a syntactic fact
 * rather than an inference.
 *
 * Schema §4.11 c18.
 */
export enum TsVariableInitializerKind {
  /** `() => …` — the link that makes the arrow callable by name. */
  ARROW = 'ARROW',
  /** `function () { }` — likewise. */
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',
  /** `new C()` — names the type as plainly as an annotation. */
  NEW = 'NEW',
  /** `f()` — the type is the callee's return type. */
  CALL = 'CALL',
  /** `{ … }`. */
  OBJECT_LITERAL = 'OBJECT_LITERAL',
  /** `[ … ]`. */
  ARRAY_LITERAL = 'ARRAY_LITERAL',
  /** A string, number, boolean or `null` literal. */
  LITERAL = 'LITERAL',
  /** A bare identifier — an alias for another binding. */
  IDENTIFIER = 'IDENTIFIER',
  /** `x as T` — the asserted type is written down. */
  AS_EXPRESSION = 'AS_EXPRESSION',
  /** `x satisfies T`. */
  SATISFIES = 'SATISFIES',
  /** `await p`. */
  AWAIT = 'AWAIT',
  /** A template literal. */
  TEMPLATE = 'TEMPLATE',
  /** `class { }` — also emits a `ts_type` row. */
  CLASS_EXPRESSION = 'CLASS_EXPRESSION',
  /** No initializer. */
  NONE = 'NONE',
  /** Anything else. Recorded rather than guessed at. */
  UNKNOWN = 'UNKNOWN',
}
