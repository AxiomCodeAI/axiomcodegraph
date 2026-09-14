/**
 * What kind of module a `js_module` row describes. Schema §3.1 c5.
 *
 * Short by design. JavaScript has no `declare module`, no `declare global` and
 * no declaration files, so the six-value `TsModuleKind` collapses to three —
 * and the `js_module` relation is **one row per file, always**, where
 * `ts_module` is one row per file plus one per ambient block.
 *
 * The distinction that survives the collapse is TypeScript's most important
 * one, because it decides the same thing here: does the file have a top-level
 * `import`/`export`? A `SOURCE_MODULE` has module scope and is always strict; a
 * `SCRIPT_GLOBAL` shares the global object and is sloppy unless it says
 * `'use strict'`. That is not bookkeeping — in sloppy mode `x = 1` with no
 * declaration creates a global binding, and in strict mode it throws.
 *
 * ```js
 * // router.js — `module.exports = Router`  →  SCRIPT_GLOBAL
 * //   CommonJS is not an ES module: no top-level import/export syntax.
 * // client.mjs — `export function get() {}` →  SOURCE_MODULE
 * // package.json imported under resolveJsonModule → JSON_MODULE
 * ```
 *
 * Note what this enum is NOT: it is not `moduleSystem`. A CommonJS file and an
 * ESM file can both be `SOURCE_MODULE` — `moduleSystem` records what the
 * governing config says, and this records what the file's own syntax does.
 * Keeping them apart is what lets `contradictsGoverningConfig` exist.
 */
export enum JsModuleKind {
  /**
   * A file with a top-level `import` or `export`.
   *
   * Module scope, and implicitly strict whatever the governing config says.
   */
  SOURCE_MODULE = 'SOURCE_MODULE',

  /**
   * A file with no top-level `import` or `export`.
   *
   * Every CommonJS file is this, which is 84.3% of the measured corpus. Its top
   * level is a function body at runtime — Node wraps it — which is why the
   * synthetic `<module>` initializer is not a convenience here.
   */
  SCRIPT_GLOBAL = 'SCRIPT_GLOBAL',

  /** A `.json` file reached by an import. Declarations, no executable code. */
  JSON_MODULE = 'JSON_MODULE',
}
