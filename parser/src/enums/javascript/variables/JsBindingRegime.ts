/**
 * How a name is bound, and therefore where it is visible and when.
 * Schema §3.7 c2, and `js_method_parameter` c12.
 *
 * ## Two regimes coexist in every real JavaScript file
 *
 * `var` (3,705 measured) is function-scoped and hoisted: the name exists from
 * the first instruction of its function, holding `undefined`, whatever line it
 * is written on. `let`/`const` (41,353) are block-scoped with a **temporal dead
 * zone**: the name exists in its block but touching it before the declaration
 * throws.
 *
 * This is Python's problem, not TypeScript's — `python-scope-builder.ts` is the
 * model. And it is not expressible as a flag, because the two regimes put the
 * *same declaration* in two different scopes, which is why `js_variable` carries
 * `declarationScopeLinkHash` **and** `syntacticScopeLinkHash`.
 *
 * ## The pair that looks like one category and is two
 *
 * Function *declarations* (5,271) hoist entirely — name and body both, so a call
 * above the declaration works. Function *expressions* (4,325) do not hoist at
 * all. Same syntax category, opposite behaviour, decided by position. An engine
 * that collapses them reports a call to an undefined value as a call to a
 * function, or the reverse.
 */
export enum JsBindingRegime {
  /**
   * `var`. Function-scoped, hoisted, no dead zone.
   *
   * The one regime whose declaration scope and syntactic scope genuinely differ:
   * a `var` inside a block is visible from the top of the enclosing *function*.
   * Gate 7.3.3 asserts every binding with this regime has a declaration scope
   * whose `isFunctionScope` is true — the hoisting model checked rather than
   * assumed.
   */
  VAR_FUNCTION_SCOPED_HOISTED = 'VAR_FUNCTION_SCOPED_HOISTED',

  /** `let`. Block-scoped, with a temporal dead zone. */
  LET_BLOCK_TDZ = 'LET_BLOCK_TDZ',

  /** `const`. Block-scoped, with a temporal dead zone, and not reassignable. */
  CONST_BLOCK_TDZ = 'CONST_BLOCK_TDZ',

  /**
   * A `function f() {}` statement.
   *
   * Hoisted with its body, so `f()` above the declaration is a working call.
   * Where it hoists *to* depends on strict mode when the declaration sits in a
   * block: strict mode makes it block-scoped, and sloppy mode's Annex B
   * semantics also bind the name in the enclosing function scope.
   */
  FUNCTION_DECLARATION_HOISTED = 'FUNCTION_DECLARATION_HOISTED',

  /**
   * A `class` declaration or a named class expression.
   *
   * Block-scoped with a dead zone, like `let` — a class is not hoisted, which
   * surprises people often enough that it is worth a distinct value.
   */
  CLASS_TDZ = 'CLASS_TDZ',

  /**
   * A function parameter.
   *
   * Bound in the function's own scope, before the body runs. Also the regime on
   * the N `js_variable` rows a destructured parameter binds: the parameter row
   * keeps `position`, and the names it binds are variables.
   */
  PARAMETER = 'PARAMETER',

  /** A `catch (e)` parameter. Bound in the catch clause's own scope. */
  CATCH_PARAMETER = 'CATCH_PARAMETER',

  /** A name bound by an `import` declaration. Module-scoped, and immutable. */
  IMPORT_BINDING = 'IMPORT_BINDING',

  /**
   * A sloppy-mode assignment to a name nobody declared.
   *
   * `x = 1` at the top of a non-strict file creates a property on the global
   * object. It is **a binding with no declaration**, and it is the reason the
   * scope tree cannot be derived from declarations alone — which is the reason
   * `js_scope` is a relation rather than a computed view.
   *
   * Only possible where `isStrictMode` is false, so a consumer can check the
   * scope before believing it.
   */
  GLOBAL_IMPLICIT = 'GLOBAL_IMPLICIT',
}
