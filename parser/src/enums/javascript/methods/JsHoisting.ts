/**
 * Whether this callable's name exists before its declaration runs.
 * Schema §3.4 c10.
 *
 * ## The same syntax category, two behaviours, decided by position
 *
 * ```js
 * f();                          // works — the declaration hoisted entirely
 * function f() {}
 *
 * g();                          // TypeError: g is not a function
 * var g = function () {};       // the VAR hoisted; the function did not
 * ```
 *
 * 5,271 function declarations and 4,325 function expressions were measured. An
 * engine that collapses them reports a call to `undefined` as a call to a
 * function, or reports a working call as unreachable — and both are wrong in the
 * direction that looks plausible.
 */
export enum JsHoisting {
  /**
   * A function declaration. Name **and body** available from the top of the
   * enclosing scope.
   *
   * Which scope depends on strict mode when the declaration sits in a block:
   * strict makes it block-scoped, and sloppy mode's Annex B semantics also bind
   * the name in the enclosing function scope. `js_variable`'s two scope columns
   * carry the answer.
   */
  HOISTED_FULLY = 'HOISTED_FULLY',

  /**
   * A function expression or arrow. Nothing hoists.
   *
   * The *binding* it is assigned to may hoist — a `var` does — but it holds
   * `undefined` until the assignment runs, which is a different fact and a
   * different column.
   */
  NOT_HOISTED = 'NOT_HOISTED',

  /**
   * A class method, or a callable bound by `let`/`const`/`class`.
   *
   * The name exists in its scope but touching it before the declaration throws.
   * Distinct from `NOT_HOISTED`, where touching it early yields `undefined`:
   * one is a crash and one is a silently wrong value.
   */
  TDZ = 'TDZ',

  /**
   * Hoisting is not a question for this row.
   *
   * The `<module>` initializer, a static block, a constructor — none of them
   * have a name a scope could hold.
   */
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}
