/**
 * The syntax that declared this type. Schema §3.2 c9.
 *
 * Separate from {@link JsTypeCategory} because the two answer different
 * questions: the category is *what kind of thing is this*, and the form is *how
 * was it written*. A constructor function and a class are different categories;
 * a class declaration and a class expression are one category written two ways,
 * and the difference decides whether the name hoists.
 */
export enum JsTypeDeclarationForm {
  /** `class Foo { … }` as a statement. The name is in a temporal dead zone. */
  CLASS_DECLARATION = 'CLASS_DECLARATION',

  /**
   * `const Foo = class { … }`, or a class as an argument or an export value.
   *
   * Does not hoist at all, unlike a function expression's *declaration*
   * counterpart — the distinction `js_method.hoisting` records.
   */
  CLASS_EXPRESSION = 'CLASS_EXPRESSION',

  /**
   * `function Foo() { this.x = 1 }` recognised as a constructor.
   *
   * Recognised by evidence, never by naming convention: a `new Foo()` somewhere,
   * a `Foo.prototype.x = …` assignment, or `this.x = …` in the body. A
   * capital-letter heuristic would classify every capitalised import as a
   * constructor.
   */
  PROTOTYPE_CONSTRUCTOR = 'PROTOTYPE_CONSTRUCTOR',

  /** `@typedef` or `@callback`. The declaration is a comment. */
  JSDOC_TYPEDEF = 'JSDOC_TYPEDEF',
}
