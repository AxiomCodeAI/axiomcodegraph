/** How a module edge IN was written. Schema §3.8 c3. */
export enum JsImportForm {
  /**
   * `require('x')`. 9,055 measured, and **1,227 of them are not top-level**.
   *
   * That 13.6% is why the import extractor reads the expression worklist rather
   * than `sourceFile.statements`: a scan of the statement list, which is what
   * every TypeScript module-edge extractor does because every TypeScript module
   * edge is a top-level declaration, misses one require in seven. 1,048 sit in a
   * function body and 179 in a block.
   */
  REQUIRE_CALL = 'REQUIRE_CALL',

  /** `import … from 'x'`. A declaration, and only legal at the top level. */
  IMPORT_DECLARATION = 'IMPORT_DECLARATION',

  /** `import('x')`. An expression returning a promise, legal anywhere, in both systems. */
  DYNAMIC_IMPORT = 'DYNAMIC_IMPORT',

  /**
   * `const require = createRequire(import.meta.url)` and the requires through it.
   *
   * How an ES module reaches CommonJS. Worth its own value because the edge is
   * spelled as an ordinary call on a local name, so an extractor matching on the
   * identifier `require` alone sees a call to an unknown function.
   */
  CREATE_REQUIRE = 'CREATE_REQUIRE',

  /**
   * `import x = require('y')`.
   *
   * TypeScript syntax that `ts.createSourceFile` will parse out of a `.js` file
   * if it encounters it. Declared so that a file carrying it produces a module
   * edge rather than a parse gap.
   */
  IMPORT_EQUALS = 'IMPORT_EQUALS',

  /**
   * `/** @type {import("./x").Y} *\/` — an `ImportTypeNode` in a JSDoc type.
   *
   * Schema §3.8.1. None of the five above: `DYNAMIC_IMPORT` is a call
   * expression and this is a type node. Minted so that a typedef whose file
   * the engine cannot locate is not the incomplete row §0.2 forbids — the
   * name present, the hop absent. `isTypeOnly = true` on every such row.
   */
  JSDOC_IMPORT_TYPE = 'JSDOC_IMPORT_TYPE',
}
