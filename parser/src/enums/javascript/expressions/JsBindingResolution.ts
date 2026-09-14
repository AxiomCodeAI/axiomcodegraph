/**
 * Which scope a name came from. Schema §3.10 c18.
 *
 * ## The binder's output, and the engine's input
 *
 * `resolvedBindingLinkHash` says *which* `js_variable` row a name refers to.
 * This says *where it was found*, and the two are not the same information. A
 * name resolved in the current scope and the same name resolved three closures
 * up point at one row and are very different facts about the code: the second
 * means the value **outlives its frame**, which is what makes a callback able to
 * see a loop variable.
 *
 * ## Both of the unresolved values are honest, and they are not the same
 *
 * `GLOBAL_BUILTIN` says the target is in the `lib_*` population — expected, and
 * 24.4% of oracle declines are exactly this. `UNRESOLVED_FREE` says the parser
 * genuinely does not know. Conflating them would hide a real gap inside a
 * category that is expected to be large, which is the §7 failure: *classify
 * environmental before reporting.*
 */
export enum JsBindingResolution {
  /** Declared in the same scope as the reference. */
  LOCAL = 'LOCAL',

  /**
   * Declared in an enclosing **function** scope. A closure capture.
   *
   * The value outlives the frame it was declared in, which is the fact that
   * distinguishes this from `LOCAL` and the reason the two are separate values
   * rather than one "found lexically".
   */
  CLOSURE = 'CLOSURE',

  /** Declared at the file's top level. */
  MODULE = 'MODULE',

  /**
   * Bound by an `import` or a `require`.
   *
   * The hop that matters: 34.4% of all oracle declines are calls through one of
   * these, and every one is reconstructable because the import row carries
   * `resolvedFilePath`.
   */
  IMPORTED = 'IMPORTED',

  /**
   * A platform name with no declaration in this file: `console`, `Array`,
   * `process`, `Buffer`.
   *
   * Not a failure. The target is in the `lib_*` population, which TypeScript
   * measured at 42.3% of its call targets and which no amount of installing
   * dependencies in the analysed repo brings into scope.
   */
  GLOBAL_BUILTIN = 'GLOBAL_BUILTIN',

  /**
   * `#brand in obj` — a class-private name in a reference position.
   *
   * Schema §3.10.1. A private name is a slot on a class, not a binding in any
   * scope chain, so every scope value is dishonest for it and `UNRESOLVED_FREE`
   * claims a binder failure that did not happen. The binder resolved it: to the
   * class whose body encloses the reference. `this.#x` is unaffected — that is
   * a property access whose member name is private.
   */
  CLASS_PRIVATE = 'CLASS_PRIVATE',

  /**
   * Not bound anywhere the parser can see, and not a known builtin.
   *
   * The honest "I do not know". Kept apart from `GLOBAL_BUILTIN` so a rising
   * count here is visible rather than absorbed into an expected category.
   */
  UNRESOLVED_FREE = 'UNRESOLVED_FREE',
}
