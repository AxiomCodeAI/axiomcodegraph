/** What the edge binds locally. Schema §3.8 c6. */
export enum JsImportBindingForm {
  /** `const x = require('y')` or `import * as x from 'y'`. The whole module object. */
  NAMESPACE = 'NAMESPACE',

  /** `import { a } from 'y'`. One named export. */
  NAMED = 'NAMED',

  /** `import x from 'y'`. The default export. */
  DEFAULT = 'DEFAULT',

  /**
   * `const { a, b } = require('y')`.
   *
   * Produces **one row per bound name**, all sharing a specifier and a line —
   * which is why `startColumn` is in `js_import`'s primary key. Without it the
   * rows collide **by doubling, not by erroring**, and the edge count is quietly
   * wrong.
   */
  DESTRUCTURED = 'DESTRUCTURED',

  /**
   * `require('./polyfill')` or `import './polyfill'` with nothing bound.
   *
   * Binds no name and is still a real module edge — the module runs and its side
   * effects happen. TypeScript had this defect: an empty import recorded no
   * module edge, so a package imported only for its ambient declarations could
   * not be staged.
   */
  SIDE_EFFECT_ONLY = 'SIDE_EFFECT_ONLY',

  /**
   * An import type binds NOTHING — `import("./x").Y` in a comment names a
   * type and introduces no local name.
   *
   * Schema §3.8.1, corrected from a proposal of `NAMED`: `NAMED` with an
   * empty `localName` asserts a binding that does not exist, and
   * `SIDE_EFFECT_ONLY` asserts a runtime effect a type reference has not. A
   * forced value reads as data; this one says what is true.
   */
  NO_LOCAL_BINDING = 'NO_LOCAL_BINDING',
  // Also the import half of a named re-export — `export { a as b } from
  // './x'` — whose source name is not in this module's scope (engine #483).
}
