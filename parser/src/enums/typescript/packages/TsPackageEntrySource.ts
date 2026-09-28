/** Which `package.json` field an entry came from. `ts_package_entry` c3. */
export enum TsPackageEntrySource {
  /** `"main"`: the CommonJS entry, and Node's answer for `require('pkg')` without `exports`. */
  MAIN = 'MAIN',
  /** `"module"`: the bundler convention for an ES entry. */
  MODULE = 'MODULE',
  /** `"exports"`: the subpath and condition map, which overrides `main` when present. */
  EXPORTS = 'EXPORTS',
  /** `"types"` / `"typings"`: the declaration entry a TypeScript consumer compiles against. */
  TYPES = 'TYPES',
  /** `"source"`: the un-built entry some build tools read. Names the source module directly. */
  SOURCE = 'SOURCE',
  /**
   * No `main` and no `exports` for `"."`: Node loads `index.js` at the package
   * root. Emitted so the default is a row rather than an absence, and never read
   * as a published entry: a package that names nothing has not said what it publishes.
   */
  DEFAULT_INDEX = 'DEFAULT_INDEX',
}
