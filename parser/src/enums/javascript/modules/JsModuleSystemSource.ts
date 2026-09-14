/**
 * **How** `moduleSystem` was decided. Schema §3.1 c8.
 *
 * ## The column that stops a default from looking like a declaration
 *
 * 91.4% of the measured corpus gets its module system by default: 76.0% have a
 * `package.json` with no `"type"` field, and 15.4% have no `package.json` at
 * all. Without this column those files are indistinguishable from the 8.6% that
 * genuinely declare CommonJS — and they are not the same claim. One is "this
 * project says CommonJS", the other is "nobody said anything and the spec's
 * default is CommonJS".
 *
 * That difference decides how much weight a consumer can put on a
 * `contradictsGoverningConfig` flag. ESM syntax under a *declared* CommonJS
 * config is a project contradicting itself; ESM syntax under an *absent*
 * `package.json` is a file nobody ever configured, which is what all 170
 * measured contradictions turned out to be.
 *
 * ## Precedence, highest first
 *
 * `.mjs`/`.cjs` override the governing `package.json` **outright** — they are
 * not hints. Everything below them is the nearest-ancestor lookup.
 */
export enum JsModuleSystemSource {
  /** `.mjs`. ESM, whatever any `package.json` says. */
  EXT_MJS = 'EXT_MJS',

  /** `.cjs`. CommonJS, whatever any `package.json` says. */
  EXT_CJS = 'EXT_CJS',

  /** The nearest-ancestor `package.json` declares `"type": "module"`. */
  PKG_TYPE_MODULE = 'PKG_TYPE_MODULE',

  /** The nearest-ancestor `package.json` declares `"type": "commonjs"`. */
  PKG_TYPE_COMMONJS = 'PKG_TYPE_COMMONJS',

  /**
   * A `package.json` governs the file and has no `"type"` field. 76.0%.
   *
   * The spec's default is CommonJS, so this is a real answer — but it is an
   * answer nobody wrote down, which is the whole reason this enum exists.
   */
  PKG_TYPE_ABSENT_DEFAULT = 'PKG_TYPE_ABSENT_DEFAULT',

  /**
   * No `package.json` anywhere up the tree. 15.4%.
   *
   * Common in loose script directories and in anything analysed outside the
   * package that ships it. The governing file is frequently not in the
   * repository at all, and this value says so rather than inventing one.
   */
  NO_PACKAGE_JSON_DEFAULT = 'NO_PACKAGE_JSON_DEFAULT',
}
