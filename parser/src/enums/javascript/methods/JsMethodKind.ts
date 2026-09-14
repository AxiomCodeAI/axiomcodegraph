/**
 * What kind of callable a `js_method` row describes. Schema §3.4 c8.
 *
 * Every callable gets a row: function declarations, function expressions,
 * arrows, class methods, accessors, prototype-assigned methods, and the
 * synthetic `<module>` initializer.
 */
export enum JsMethodKind {
  /** `function f() {}` as a statement. 5,271 measured, and all of them hoist. */
  FUNCTION_DECLARATION = 'FUNCTION_DECLARATION',

  /**
   * `const f = function () {}`, or a function passed as an argument.
   *
   * 4,325 measured, and **none of them hoist**. Same syntax category as the
   * declaration, opposite behaviour, decided entirely by position — which is why
   * `hoisting` is a column.
   */
  FUNCTION_EXPRESSION = 'FUNCTION_EXPRESSION',

  /**
   * `() => {}`.
   *
   * 9,391 measured, many sharing a line, which is why `startColumn` is in
   * `js_method`'s primary key. Binds neither `this` nor `arguments`.
   */
  ARROW = 'ARROW',

  /** A method in a class body, or one assigned to a prototype. */
  CLASS_METHOD = 'CLASS_METHOD',

  /** `constructor() {}`. */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /**
   * `get x() {}`. 1,225 measured.
   *
   * A **property read that invokes a function**. The declaration is emittable
   * and the invocation is not — `GETTER_INVOCATION` is reserved with a zero-row
   * assertion, because whether `obj.x` invokes anything is a fact about `obj`.
   */
  GETTER = 'GETTER',

  /** `set x(v) {}`. 137 measured. Same asymmetry. */
  SETTER = 'SETTER',

  /**
   * The synthetic `<module>` method that owns top-level executable code.
   *
   * Carries more weight here than in TypeScript: a CommonJS file's top level
   * genuinely **is** a function body at runtime, because Node wraps it, and the
   * 83.6% of module edges that are expression-borne all hang off this row.
   */
  MODULE_INITIALIZER = 'MODULE_INITIALIZER',

  /** `static { … }` in a class body. */
  STATIC_BLOCK = 'STATIC_BLOCK',
}
