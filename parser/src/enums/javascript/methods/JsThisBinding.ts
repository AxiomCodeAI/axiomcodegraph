/**
 * What `this` is inside this callable. Schema §3.4 c17.
 *
 * ## 33,189 `this` references, and the call form decides what they mean
 *
 * This is the column with no analogue in any other front end in the repository,
 * and it is not a convenience. In Java and Python the receiver of a method is
 * fixed at the declaration. In JavaScript:
 *
 * ```js
 * const m = obj.method;  m();          // `this` is undefined / global
 * obj.method();                        // `this` is obj
 * obj.method.call(other);              // `this` is other
 * const bound = obj.method.bind(obj);  // `this` is obj, permanently
 * arr.map(x => this.f(x));             // `this` is the ENCLOSING function's
 * ```
 *
 * Every line invokes the same function body and `this` differs. An engine that
 * treats every callable as rebinding `this` gets the arrow case wrong, and an
 * engine that treats none of them as rebinding gets the other four wrong.
 */
export enum JsThisBinding {
  /**
   * An arrow function. `this` comes from **where the arrow was written**.
   *
   * The whole of lexical `this`, and what makes `this.f()` work inside a
   * callback without `.bind(this)`. `js_scope.bindsThis` is false for `ARROW` for
   * the same reason.
   */
  LEXICAL = 'LEXICAL',

  /**
   * An ordinary `function`. `this` is decided **at the call site**.
   *
   * The default, and the source of every "cannot read property of undefined"
   * that comes from passing a method as a callback.
   */
  DYNAMIC = 'DYNAMIC',

  /**
   * The result of `.bind(receiver)`. `this` is fixed and cannot be changed —
   * not by `.call`, not by `.apply`.
   *
   * 189 `.bind` sites measured. The other half of `FUNCTION_CALL_BIND`, which
   * records the call that produces the bound function.
   */
  BOUND = 'BOUND',

  /**
   * `this` is not meaningful here.
   *
   * A module-level function in an ES module, where `this` is `undefined`
   * outright, and the `<module>` initializer, where in CommonJS it is
   * `module.exports` and in ESM it is `undefined` — two different values, which
   * is why the honest answer is to decline rather than pick one.
   */
  NONE = 'NONE',
}
