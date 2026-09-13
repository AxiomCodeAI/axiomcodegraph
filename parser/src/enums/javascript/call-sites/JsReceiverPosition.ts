/**
 * Where the receiver actually is. Schema §3.11 c4.
 *
 * ## This column exists for 1,048 call sites and it is not a rounding error
 *
 * `f.call(obj, a)` and `f.apply(obj, args)` move the receiver into an
 * **argument**. An engine reading the syntactic receiver of `f.call(obj, a)`
 * gets `f` — or worse, resolves `.call` and gets `Function.prototype.call` — and
 * the real receiver `obj` is not consulted at all. That is a wrong edge, not a
 * missing one.
 *
 * `receiverExpressionLinkHash` points at the **real** receiver wherever it sits,
 * and this column says where that was, so a consumer never has to re-derive it
 * from the call kind.
 */
export enum JsReceiverPosition {
  /** `obj.m()` — the receiver is the member expression's object, as written. */
  SYNTACTIC = 'SYNTACTIC',

  /**
   * `f.call(obj, …)` / `f.apply(obj, args)` — the receiver is argument 0.
   *
   * 859 sites. `.bind` is the third member of this family and is counted with
   * it, though it produces a function rather than invoking one.
   */
  FIRST_ARGUMENT = 'FIRST_ARGUMENT',

  /** `fn()` — no receiver. `this` is `undefined` in strict mode, global in sloppy. */
  NONE = 'NONE',
}
