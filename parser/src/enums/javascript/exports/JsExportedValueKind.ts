/**
 * What is on the right-hand side. Schema §3.9 c4.
 *
 * The column answers the question an **importer** actually asks: given
 * `const R = require('./router')`, what is `R`? A function, a class, an object
 * of functions, or another module entirely — and those are four different things
 * to do next.
 *
 * `OBJECT_LITERAL` at 335 measured is the pre-ES6 namespace, and the reason
 * object literals reach the fact base as expressions with
 * `js_variable.initializerKind = OBJECT_LITERAL` rather than as `js_type` rows.
 */
export enum JsExportedValueKind {
  /** `module.exports = function () {}`. 24 measured. The module IS callable. */
  FUNCTION = 'FUNCTION',

  /** `module.exports = class { … }`. The module is a constructor. */
  CLASS = 'CLASS',

  /** `module.exports = { a, b }`. 335 measured. The pre-ES6 namespace. */
  OBJECT_LITERAL = 'OBJECT_LITERAL',

  /**
   * `module.exports = require('./y')`. **81 measured.**
   *
   * A module edge that is **simultaneously an import and an export**, and the
   * one construct that needs two rows in two relations for one line of source.
   * `isReExport`, `reExportSpecifier` and `reExportImportLinkHash` are the
   * columns that keep the pair joinable.
   */
  REQUIRE_REEXPORT = 'REQUIRE_REEXPORT',

  /** `module.exports = Foo`, where `Foo` is a local name. The common case. */
  IDENTIFIER = 'IDENTIFIER',

  /** Anything else: a call result, a member access, a literal, an operator. */
  OTHER = 'OTHER',
}
