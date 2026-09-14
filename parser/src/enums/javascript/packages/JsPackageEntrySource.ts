/** Which `package.json` field an entry came from. Schema §3.17 c3. */
export enum JsPackageEntrySource {
  /** `"main"`: the CommonJS entry, and Node's answer for `require('pkg')` without `exports`. */
  MAIN = 'MAIN',
  /** `"module"`: the bundler convention for an ES entry. Node never reads it; bundlers do. */
  MODULE = 'MODULE',
  /** `"exports"`: the subpath and condition map, which overrides `main` when present. */
  EXPORTS = 'EXPORTS',
  /**
   * No `main` and no `exports` for `"."`: Node loads `index.js` at the package
   * root. Emitted so the default is a row rather than an absence.
   */
  DEFAULT_INDEX = 'DEFAULT_INDEX',
}
