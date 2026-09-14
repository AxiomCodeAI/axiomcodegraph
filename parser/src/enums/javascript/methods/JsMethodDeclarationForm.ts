/**
 * How a callable was declared — as syntax, or as an assignment. Schema §3.4 c9.
 *
 * ## Members declared by assignment are declarations, not expressions
 *
 * `Foo.prototype.bar = function () {}` is a **method declaration written as an
 * assignment**. By ruling, these mint real `js_method` rows, and they are
 * **also** expressions — the assignment really happens at a particular point in
 * the program — so the row is minted in both relations and
 * `js_method.sourceExpressionLinkHash` ties them.
 *
 * Both halves matter. Emitting only the expression is the §3 defect class: the
 * parts emit trivially and the structure is entirely absent. Emitting only the
 * declaration loses the fact that it executes, which in a conditional or an IIFE
 * is the whole point.
 *
 * Gate 7.3.7 asserts the round trip: every row with a form other than
 * `SYNTACTIC` has a `sourceExpressionLinkHash` that resolves, and that
 * expression has `isDeclarationBearing = true`.
 */
export enum JsMethodDeclarationForm {
  /** Written as a function, method, arrow or accessor. 6,586 class members. */
  SYNTACTIC = 'SYNTACTIC',

  /** `Foo.prototype.bar = function () {}`. 361 measured. An instance method. */
  PROTOTYPE_ASSIGNMENT = 'PROTOTYPE_ASSIGNMENT',

  /**
   * `Foo.staticM = function () {}`. **521 measured — more common than the
   * prototype form.**
   *
   * Worth knowing, because the prototype idiom is the famous one and the static
   * one is what real code does more of.
   */
  STATIC_ASSIGNMENT = 'STATIC_ASSIGNMENT',

  /**
   * `Foo.prototype = { m() {}, n() {} }`. 15 measured.
   *
   * Replaces the whole prototype object, so it also **discards** anything
   * previously on it — including `constructor`. Each member of the literal is
   * its own method row.
   */
  PROTOTYPE_OBJECT_LITERAL = 'PROTOTYPE_OBJECT_LITERAL',

  /**
   * `Object.defineProperty(Foo.prototype, 'x', { get() {} })`. 76 measured.
   *
   * The only form that can declare a non-enumerable or non-writable member, and
   * the only one where a getter and a setter arrive in one statement.
   */
  OBJECT_DEFINE_PROPERTY = 'OBJECT_DEFINE_PROPERTY',

  /** `Object.assign(Foo.prototype, { … })`. 2 measured. A bulk prototype install. */
  OBJECT_ASSIGN_PROTOTYPE = 'OBJECT_ASSIGN_PROTOTYPE',
}
