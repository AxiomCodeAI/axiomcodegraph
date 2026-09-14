/**
 * Whether this module edge was written as a declaration or as an expression.
 * Schema §3.8 c2 and §3.9 c2.
 *
 * ## The finding that made JavaScript its own front end
 *
 * **11,655 of 13,936 module edges — 83.6% — are expression-borne.**
 * `require('./x')` is a call. `module.exports = X` is an assignment. No
 * TypeScript relation expects this, because every TypeScript module edge is a
 * declaration at the top of a file, and routing expression-minted rows into
 * `ts_import` would have inverted the build order in §1 of
 * `BUILDING-A-PARSER.md` for the whole front end.
 *
 * So `js_import` and `js_export` are minted in a **second pass, from
 * `js_expression` rows**, and `sourceExpressionLinkHash` points back at the
 * expression each was minted from — which is what makes the second pass
 * auditable rather than asserted. Gate 7.3.1: every expression with
 * `isModuleEdge` is pointed at by **exactly one** import or export row. That is
 * what stops the second pass double-minting, which would **double** the edge
 * count rather than collide.
 *
 * ## It is a partition, not a flag
 *
 * Per-file: **2,300 files wholly `EXPRESSION`, 431 wholly `DECLARATION`, 0
 * mixed.** Bimodal, not averaged — so a consumer can treat the value as a
 * property of the file, and a file that *is* mixed is worth looking at.
 */
export enum JsEdgeBearer {
  /** `import … from 'x'`, `export …`. A declaration, always at the top level. */
  DECLARATION = 'DECLARATION',

  /** `require('x')`, `import('x')`, `module.exports = …`. An expression. 83.6%. */
  EXPRESSION = 'EXPRESSION',

  /**
   * A JSDoc `import("./x").Y` — JavaScript's `import type`, in a comment.
   *
   * Schema §3.8.1. Type-only, no runtime behaviour, no expression. The
   * partition statistics above — 83.6%, the bimodality, the 0-mixed count —
   * are over RUNTIME edges (`DECLARATION` and `EXPRESSION`) and exclude this
   * value; and the module-edge gate pairs a COMMENT row through
   * `js_type_reference.importLinkHash` rather than through an expression.
   */
  COMMENT = 'COMMENT',
}
