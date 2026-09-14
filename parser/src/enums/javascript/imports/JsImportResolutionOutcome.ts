/**
 * What happened when the specifier was resolved. Schema §3.8 c10.
 *
 * Resolution here is `ts.resolveModuleName`, a **pure function** of a specifier,
 * options and a host. It needs no Program, no typecheck and no installed
 * `node_modules` for its answer to be honest: an unresolvable specifier returns
 * `undefined`, which is a correct answer and not a missing one.
 *
 * ## Environmental unresolution is named, not hidden and not counted as a gap
 *
 * 3.2% of edges do not resolve, and the reasons are not interchangeable. §7 of
 * `BUILDING-A-PARSER.md`: missing `node_modules` accounted for 10,068 of zod's
 * 10,162 incomplete hand-offs, and *reporting those as parser gaps is wrong;
 * hiding them is also wrong.* Naming them is the third option.
 */
export enum JsImportResolutionOutcome {
  /** Resolved to a file inside the analysed project. The engine can follow it. */
  RESOLVED_PROJECT = 'RESOLVED_PROJECT',

  /** Resolved into `node_modules`. Real, and outside the project's provenance. */
  RESOLVED_EXTERNAL = 'RESOLVED_EXTERNAL',

  /**
   * A Node builtin: `path`, `fs`, `events`, `util`.
   *
   * **Not a failure.** Calls through one of these are 15.3-24.4% of all oracle
   * declines, and the target lives in the `lib_*` population rather than
   * anywhere in the repository — which no amount of installing dependencies
   * changes.
   */
  RESOLVED_BUILTIN = 'RESOLVED_BUILTIN',

  /**
   * A package that is not installed, or a relative path that does not exist.
   *
   * Environmental for the first and a genuine defect for the second: 0 relative
   * paths failed to resolve in the measured corpus, so a non-zero count here is
   * worth investigating rather than classifying.
   */
  UNRESOLVED_MISSING = 'UNRESOLVED_MISSING',

  /** `require(variable)`. Unresolvable by construction, and never guessed. */
  UNRESOLVED_NON_LITERAL = 'UNRESOLVED_NON_LITERAL',
}
