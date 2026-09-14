/**
 * The syntax that bound a name. Schema §3.7 c6 and §3.5 c10.
 *
 * ## Why a destructuring pattern is one row plus N, and not N rows
 *
 * 6,909 destructuring patterns were measured. A destructured *parameter* is
 * **one** `js_method_parameter` row — because `position` has to stay meaningful,
 * and `function f({ a, b }, c)` has `c` at position 1, not 2 — plus N
 * `js_variable` rows for the names it actually binds.
 *
 * Emitting N parameter rows breaks `position`. Emitting one row with no binding
 * information loses every name. That is §3 of `BUILDING-A-PARSER.md` exactly:
 * *the parts get emitted, the structure does not.* The fix is the same one Java
 * had first — one node for the construct, its parts parented to it, and the
 * variant in a column.
 */
export enum JsVariableBindingForm {
  /** A plain name: `const x = 1`. */
  IDENTIFIER = 'IDENTIFIER',

  /** `const { a, b: c } = o`. Binds by property name, with renaming. */
  OBJECT_PATTERN = 'OBJECT_PATTERN',

  /** `const [a, , b] = xs`. Binds by position, with holes. */
  ARRAY_PATTERN = 'ARRAY_PATTERN',

  /**
   * `function f(x = 1)`, or `const { a = 1 } = o`.
   *
   * A parameter-only form in practice: the default makes the parameter optional
   * and the expression runs at call time, in the function's own scope.
   */
  ASSIGNMENT_PATTERN = 'ASSIGNMENT_PATTERN',
}
