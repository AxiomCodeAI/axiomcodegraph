/**
 * What kind of scope a `js_scope` row describes. Schema §3.13 c0.
 *
 * ## This relation is why JavaScript is a Python port and not a TypeScript one
 *
 * There is **no `ts_*` analogue at all.** The TypeScript spine has no scope
 * relation because declared types carry resolution: 85.3% of its parameters are
 * annotated, so a receiver's type is readable at the declaration site and a
 * binder pass is not needed to be useful. In JavaScript effectively no parameters
 * carry a syntactic annotation, and the oracle itself decides only 52.6% of call
 * sites. The binder *is* the resolution mechanism here, so the scope tree is a
 * first-class relation rather than an internal detail.
 *
 * ## The distinction that carries the most weight
 *
 * `isFunctionScope` — true for `FUNCTION`, `ARROW`, `MODULE` and `GLOBAL` —
 * is what makes hoisting representable. `var` hoists to the nearest function
 * scope; `let` stops at the nearest block. Those are two different scopes for
 * the same declaration, which is why `js_variable` has **two** scope columns and
 * not one.
 *
 * ## Blocks and scopes are not the same thing
 *
 * `js_block` is syntax; `js_scope` is binding. A bare `{}` containing only `var`
 * declarations opens no scope at all, and a function's parameter list and body
 * are one scope spanning two syntactic regions. Keeping them in separate
 * relations is what lets `js_block.opensScope` be false without losing the block.
 */
export enum JsScopeKind {
  /**
   * The ambient scope holding the platform's own bindings.
   *
   * One row per module, and the only kind whose `parentScopeLinkHash` is `""`.
   * It is per-module in the fact base because every row carries an
   * `ownerModuleLinkHash` and the parser emits per-file facts — it cannot mint a
   * row shared across files without doing cross-file work.
   *
   * **The row means the global scope as observed from this module.** Proving
   * that the N rows across N modules are one runtime scope is a join, and joins
   * are the engine's. Ruled rather than assumed: the alternative — no `GLOBAL`
   * row — leaves two columns pointing at nothing, and a dangling FK to save one
   * row per file is a bad trade.
   *
   * It is not decoration. Two things need a scope above the module's:
   * `bindingResolution = GLOBAL_BUILTIN`, for a name like `console` that
   * resolves to nothing in any lexical scope; and `GLOBAL_IMPLICIT`, the
   * sloppy-mode `x = 1` with no declaration, which creates a binding **visible
   * to other files**. Parenting that at the module scope would assert it is
   * module-local, which is the one thing it is not.
   */
  GLOBAL = 'GLOBAL',

  /**
   * The file's own top-level scope. One per module, always.
   *
   * A function scope for `var` purposes under both module systems, and for
   * different reasons: an ES module's top level genuinely is its own scope, and
   * a CommonJS file's top level is a **function body** at runtime because Node
   * wraps it in one. So a top-level `var` in a `.cjs` file is module-local
   * rather than global, and this is the scope it lands in.
   */
  MODULE = 'MODULE',

  /**
   * A `function` — declaration, expression, method, constructor or accessor.
   *
   * Binds `this` dynamically and binds `arguments`. Both are what an arrow does
   * not do, and that difference is the reason `ARROW` is a separate kind rather
   * than a flag.
   */
  FUNCTION = 'FUNCTION',

  /**
   * An arrow function.
   *
   * A function scope for `var`, and **not** a `this` scope: an arrow inherits
   * `this` and `arguments` from wherever it was written. That is what makes
   * `this` usable inside a callback without `.bind(this)`, and it is why
   * `bindsThis` is a column — an engine that treats every callable as rebinding
   * `this` gets 33,189 measured `this` references wrong in the direction that
   * looks plausible.
   */
  ARROW = 'ARROW',

  /**
   * A block: `{ … }`, a loop body, a `switch` body.
   *
   * Holds `let`, `const` and `class` bindings, and holds no `var` binding ever.
   * A loop head is part of its body's scope for `let i`, which is what makes
   * each iteration's `i` a distinct binding.
   */
  BLOCK = 'BLOCK',

  /**
   * A `catch (e) { … }` clause.
   *
   * Its own kind because the parameter is bound by a form that is neither a
   * declaration nor a function parameter — hence `CATCH_PARAMETER` as its own
   * binding regime.
   */
  CATCH = 'CATCH',

  /**
   * A class body.
   *
   * Two things make it a scope: the class's own name is bound inside it (so a
   * method can refer to the class even when the binding outside was
   * reassigned), and a class body is **always strict** regardless of anything
   * around it.
   */
  CLASS = 'CLASS',

  /** A `static { … }` block. A function-like scope with its own `this`. */
  CLASS_STATIC_BLOCK = 'CLASS_STATIC_BLOCK',

  /**
   * A `with (obj) { … }` body.
   *
   * Every name inside it is **statically unresolvable**, because whether an
   * identifier is a property of `obj` is a runtime fact. The honest answer is to
   * mark the scope — `hasWithStatement` — rather than emit confident bindings
   * that may all be wrong.
   */
  WITH = 'WITH',
}
