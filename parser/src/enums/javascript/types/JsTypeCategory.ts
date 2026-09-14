/**
 * What kind of type a `js_type` row describes. Schema §3.2 c8.
 *
 * ## Object literals are NOT here, and that is a deliberate omission
 *
 * An object literal is a **value**. Treating every one as a type is how a
 * JavaScript fact base acquires 50,000 meaningless types, and it is a tempting
 * mistake because the pre-ES6 module pattern really does use an object literal
 * where a modern codebase would use a class. The literal still reaches the fact
 * base — as a `js_expression`, with `js_variable.initializerKind =
 * OBJECT_LITERAL` naming it — so a call through one of its properties is
 * followable without a fictional type row.
 */
export enum JsTypeCategory {
  /** `class Foo { … }` or a named `class` expression. 6,586 members measured. */
  CLASS = 'CLASS',

  /**
   * A function used as a constructor: `function Foo() { this.x = 1 }` with
   * prototype members hung off it.
   *
   * The pre-ES6 class, and the reason `js_method`/`js_field` accept rows minted
   * from assignments. 361 prototype methods and 233 prototype properties were
   * measured, and the runtime's standard library has been modernised since — a 2015-era corpus
   * inverts those counts.
   */
  CONSTRUCTOR_FUNCTION = 'CONSTRUCTOR_FUNCTION',

  /**
   * `@typedef {{a: string}} Foo` — **a type whose only evidence is a comment.**
   *
   * 1,825 measured. `js_type` therefore has rows with `evidenceKind =
   * COMMENT_ONLY` and a `startLine` inside a comment, and an FK from a
   * `js_variable` to one of them is an ordinary FK. `isTypeOnly` is true and no
   * call-graph rule may traverse it.
   */
  JSDOC_TYPEDEF = 'JSDOC_TYPEDEF',

  /**
   * `@callback Handler` — a function *shape* declared in a comment. 103 measured.
   *
   * Type-only, like `JSDOC_TYPEDEF`, and worth its own value because it names a
   * callable and is therefore the one most likely to be mistaken for a call
   * target. It is not one.
   */
  JSDOC_CALLBACK = 'JSDOC_CALLBACK',

  /**
   * An anonymous class expression: `module.exports = class { … }`.
   *
   * Its only name is its file's, which is why `js_type`'s key chains off
   * `ownerModuleLinkHash` rather than re-deriving a qualified name — two such
   * files in one directory would collide on any name-derived key.
   */
  ANONYMOUS_CLASS = 'ANONYMOUS_CLASS',
}
