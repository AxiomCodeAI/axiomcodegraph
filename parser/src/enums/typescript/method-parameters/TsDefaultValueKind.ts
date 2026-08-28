/**
 * The shape of a parameter's default value.
 *
 * A categorical summary of an expression that also has a full `ts_expression`
 * tree hanging off `tsExpressionLinkHash`. The column exists so a rule can
 * filter — "every parameter defaulting to a call" — without walking the tree,
 * and so a default that is a literal is distinguishable from one that runs code.
 *
 * ## Examples
 *
 * ```ts
 * function f(
 *     a = "x",              // STRING
 *     b = 1,                // NUMBER
 *     c = true,             // BOOL
 *     d = null,             // NULL
 *     e = undefined,        // UNDEFINED
 *     g = { k: 1 },         // OBJECT
 *     h = [1, 2],           // ARRAY
 *     i = make(),           // CALL     — runs at every call with `i` omitted
 *     j = new Repo(),       // NEW      — allocates at every such call
 *     k = DEFAULT,          // IDENTIFIER
 *     l = () => 0,          // ARROW
 *     m = `${x}`,           // TEMPLATE
 * ) { }
 * ```
 *
 * `CALL` and `NEW` are the members worth filtering on: a default that constructs
 * or invokes runs once per call, not once per program, and that is a real
 * behavioural fact rather than a formatting detail.
 *
 * Schema §4.7 c16.
 */
export enum TsDefaultValueKind {
  /** No default. */
  NONE = 'NONE',
  /** A string or no-substitution template literal. */
  STRING = 'STRING',
  /** A numeric or bigint literal. */
  NUMBER = 'NUMBER',
  /** `true` or `false`. */
  BOOL = 'BOOL',
  /** `null`. */
  NULL = 'NULL',
  /** `undefined`. */
  UNDEFINED = 'UNDEFINED',
  /** An object literal. */
  OBJECT = 'OBJECT',
  /** An array literal. */
  ARRAY = 'ARRAY',
  /** A call — evaluated on every invocation that omits the argument. */
  CALL = 'CALL',
  /** A `new` expression — allocates on every such invocation. */
  NEW = 'NEW',
  /** A bare identifier reference. */
  IDENTIFIER = 'IDENTIFIER',
  /** An arrow or function expression. */
  ARROW = 'ARROW',
  /** A template expression with substitutions. */
  TEMPLATE = 'TEMPLATE',
  /** Anything else — recorded rather than guessed at. */
  UNKNOWN = 'UNKNOWN',
}
