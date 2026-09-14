/**
 * What the specifier syntactically is. Schema §3.8 c1.
 *
 * `NON_LITERAL` is the value that matters: **17 measured**, each one a module
 * edge that is **unresolvable by construction**. `require(name)` where `name` is
 * a variable cannot be resolved by any amount of static analysis, and the honest
 * row says so — `specifierKind = NON_LITERAL`, `resolvedFilePath = ""`,
 * `resolutionOutcome = UNRESOLVED_NON_LITERAL`.
 *
 * The alternative is to guess, and a guessed module edge is worse than an absent
 * one because nothing downstream can tell it from a real one.
 */
export enum JsSpecifierKind {
  /** `require('./x')`. The normal case, and the only resolvable one. */
  STRING_LITERAL = 'STRING_LITERAL',

  /** `require(name)`, `require(cond ? a : b)`. 17 measured. Unresolvable, and said so. */
  NON_LITERAL = 'NON_LITERAL',

  /**
   * ``require(`./locales/${lang}`)``.
   *
   * Separate from `NON_LITERAL` because the *shape* is known even though the
   * value is not — a consumer can see the directory being indexed into, which is
   * enough to stage a whole subtree. A plain `NON_LITERAL` offers nothing.
   */
  TEMPLATE = 'TEMPLATE',
}
