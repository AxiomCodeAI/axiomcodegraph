/**
 * Which relation `targetLinkHash` points into. Schema §3.9 c10.
 *
 * A polymorphic FK, discriminated by a sibling column — the same shape
 * `js_type_reference.ownerKind` and `js_comment.attachedToKind` use. The
 * alternative, five nullable FK columns, costs five columns to say what one
 * says, and a reader then has to check all five to find the one populated.
 */
export enum JsExportTargetKind {
  /** FK→`js_method`. `module.exports = function f() {}`. */
  METHOD = 'METHOD',

  /** FK→`js_type`. `module.exports = class Foo {}`. */
  TYPE = 'TYPE',

  /** FK→`js_variable`. `module.exports = localName`. */
  VARIABLE = 'VARIABLE',

  /** FK→`js_field`. `exports.x = …` where `x` is also a declared member. */
  FIELD = 'FIELD',

  /**
   * FK→`js_expression`. The value is not a declaration at all.
   *
   * `module.exports = compute()` or `module.exports = a || b`. There is nothing
   * to point at but the expression, and pointing at the expression is a complete
   * answer — the engine can walk it.
   */
  EXPRESSION_VALUE = 'EXPRESSION_VALUE',
}
