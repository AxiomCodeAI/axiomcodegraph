/** How a module edge OUT was written. Schema §3.9 c3. */
export enum JsExportForm {
  /**
   * `module.exports = X`. **2,102 measured** — the most common export in
   * JavaScript.
   *
   * An **export expressed as an assignment**, and a *replacing* one: it discards
   * whatever `module.exports` held before, which is what
   * `overwritesPreviousExport` records.
   */
  MODULE_EXPORTS_ASSIGNMENT = 'MODULE_EXPORTS_ASSIGNMENT',

  /** `module.exports.foo = …`. 380 measured. Adds one name, replaces nothing. */
  MODULE_EXPORTS_MEMBER = 'MODULE_EXPORTS_MEMBER',

  /**
   * `exports.foo = …`. 118 measured.
   *
   * The same edge as `MODULE_EXPORTS_MEMBER` through a different alias, and kept
   * separate because the two stop being equivalent the moment a
   * `module.exports = {}` runs: `exports` still points at the old object, so a
   * later `exports.x = 1` exports nothing at all.
   */
  EXPORTS_MEMBER = 'EXPORTS_MEMBER',

  /**
   * `Object.defineProperty(exports, 'x', { get() { … } })`.
   *
   * What transpilers emit, and the only export form that is lazy — the value is
   * computed on first read.
   */
  OBJECT_DEFINE_PROPERTY = 'OBJECT_DEFINE_PROPERTY',

  /** `export const x = 1`, `export { a as b }`. A declaration. */
  EXPORT_DECLARATION = 'EXPORT_DECLARATION',

  /** `export default X`. */
  EXPORT_DEFAULT = 'EXPORT_DEFAULT',

  /**
   * `export * from './y'`, and `export * as ns from './y'`. An import and an
   * export in one statement; the second spelling is the same edge under one
   * exported name, and `exportedName` is what tells them apart — `*` for the
   * bare form, the name for the namespaced one.
   */
  EXPORT_ALL = 'EXPORT_ALL',
}
