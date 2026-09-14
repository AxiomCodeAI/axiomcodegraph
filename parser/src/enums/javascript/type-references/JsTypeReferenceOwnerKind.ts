/**
 * Which relation `ownerLinkHash` points into. Schema §3.14 c9.
 *
 * A polymorphic FK discriminated by a sibling column, the same shape
 * `js_export.targetKind` uses — one column plus a discriminator rather than five
 * mostly-empty FK columns a reader has to check in turn.
 */
export enum JsTypeReferenceOwnerKind {
  METHOD = 'METHOD',
  METHOD_PARAMETER = 'METHOD_PARAMETER',
  FIELD = 'FIELD',
  VARIABLE = 'VARIABLE',
  TYPE = 'TYPE',

  /**
   * A `js_expression` row. `ownerLinkHash` → `js_expression`.
   *
   * ## One value, because ownerKind names the RELATION
   *
   * Ruled by js-oracle after 396 `@type` positions were found with nowhere to
   * be owned: 268 on an object-literal property (`{ /** @type {T} *\/ items: [] }`
   * — §3.2 rules that an object literal is a value, so there is no js_field) and
   * 128 on an exports-member assignment (`/** @type {T} *\/ exports.X = …`, which
   * mints a module edge, not a type declaration). Both are expressions, and the
   * construct distinction between them is already carried by the expression
   * row's own `expressionKind`, so a second owner value would say what a join
   * already says.
   *
   * Emitted only when no declaration path claimed the annotation: `this.x =` in
   * a constructor is a FIELD's, `ret = …` is a VARIABLE's, `Foo.prototype.m =`
   * is a FIELD's. This is the owner of last resort, not a second route to any
   * of those.
   */
  EXPRESSION = 'EXPRESSION',
}
