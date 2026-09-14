/**
 * How a scope came to be strict, or why it is not. Schema §3.13 c7.
 *
 * ## Strict mode is not bookkeeping
 *
 * In sloppy mode `x = 1` with no declaration **creates a global binding**. In
 * strict mode the same line **throws**. So the same source text is a binding in
 * one file and an error in another, and the deciding input is either a directive
 * inside the file or the module system decided by a `package.json` the file does
 * not contain.
 *
 * That is precisely why `js_module.moduleSystem` is in the module's primary key:
 * the two answers are two different programs, and `GLOBAL_IMPLICIT` exists in
 * one of them and not the other.
 *
 * Recording the *source* rather than only the boolean matters for the same
 * reason `moduleSystemSource` does. A strictness inherited from an ES module is
 * a property of the whole file; one from a `'use strict'` directive at the top of
 * one function is a property of that function; one from a class body applies to
 * a region nobody wrote a directive for. A consumer asking "could this
 * assignment have created a global?" needs to know which.
 */
export enum JsStrictModeSource {
  /**
   * The file is an ES module, so every scope in it is strict.
   *
   * Not overridable and not opt-out: there is no way to write a sloppy ES
   * module.
   */
  ESM_IMPLICIT = 'ESM_IMPLICIT',

  /**
   * A `'use strict'` directive at the top of this scope or an enclosing one.
   *
   * The CommonJS route, and the only one available to a CommonJS file.
   */
  USE_STRICT_DIRECTIVE = 'USE_STRICT_DIRECTIVE',

  /**
   * A class body, which is strict whatever surrounds it.
   *
   * The one source that applies to a region with no directive in it and no
   * module system behind it — a class in a sloppy CommonJS file has a strict
   * body, and every method in it is strict too.
   */
  CLASS_BODY_IMPLICIT = 'CLASS_BODY_IMPLICIT',

  /**
   * Not strict.
   *
   * The default for CommonJS, which is 84.3% of the measured corpus. This is the
   * value that makes `GLOBAL_IMPLICIT` possible, so it is the one a consumer
   * checks before believing an undeclared assignment is a global.
   */
  SLOPPY = 'SLOPPY',
}
