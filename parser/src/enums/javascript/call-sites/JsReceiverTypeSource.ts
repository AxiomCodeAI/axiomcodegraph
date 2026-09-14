/**
 * How much the engine has to work with for this receiver. Schema §3.11 c10.
 *
 * ## The 52.6% ceiling, made explicit per call site instead of inferred later
 *
 * The oracle — tsc with `checkJs` — decides only 52.6% of call sites, because
 * JavaScript types are inferred rather than declared. The parser will not name
 * the target for roughly half of all calls, and pretending otherwise produces a
 * confidently wrong fact base.
 *
 * What the parser *can* always say is **which channel, if any, carries type
 * information about this receiver**. That turns "unresolved" from one
 * undifferentiated bucket into five actionable ones, and it is stated per row so
 * a consumer never has to reconstruct it by joining four relations.
 */
export enum JsReceiverTypeSource {
  /** Nothing. A local with no annotation, no import, and no class in sight. */
  NONE = 'NONE',

  /**
   * A JSDoc `@param`/`@type` names the receiver's type.
   *
   * 37.9% of parameters carry one, and this is the only declared-type channel
   * the language has — syntactic annotations measure 0 in the replication corpus, and the 64
   * of those are Flow.
   */
  JSDOC = 'JSDOC',

  /**
   * The receiver is a name bound to a `require()` or an `import`.
   *
   * **The largest single lever.** `const x = require('y'); x.foo()` is 34.4% of
   * all oracle declines — 15,759 sites — and every one of them is
   * *reconstructable* rather than unresolvable: the import row carries
   * `resolvedFilePath`, so the engine has the file even though the parser has
   * no type. `importLinkHash` is the hop.
   */
  IMPORT_ALIAS = 'IMPORT_ALIAS',

  /**
   * The receiver is a `new`-ed class or constructor function declared in **this
   * file**.
   *
   * The one case the parser can nearly finish, and the reason `resolutionOutcome
   * = SAME_FILE_RESOLVED` exists.
   */
  LOCAL_CLASS = 'LOCAL_CLASS',

  /**
   * The receiver came from a Node builtin — `path`, `fs`, `events`, `util`.
   *
   * **24.4% of all oracle declines**, and the correction that mattered most in
   * the schema's measurement: the environmental class TypeScript had (missing
   * `node_modules`) is genuinely small here at 1.5%, and a *different, larger*
   * one takes its place. Forcing `types: ["node"]` moved one web framework from 12.9% to
   * 21.9% resolved.
   *
   * It is not fixable by installing anything in the repo under analysis. It is
   * the `lib_*` population — the JavaScript spelling of
   * `ts_call_site.resolvedTargetKind = LIB_SIGNATURE`, which TypeScript measured
   * at 42.3% of call targets.
   */
  NODE_BUILTIN = 'NODE_BUILTIN',
}
