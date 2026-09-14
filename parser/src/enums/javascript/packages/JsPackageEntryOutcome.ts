/** Whether the entry's target is a module in this parse. Schema §3.17 c6. */
export enum JsPackageEntryOutcome {
  /** The target is a JavaScript file this parse emitted; `targetModuleLinkHash` names it. */
  RESOLVED = 'RESOLVED',
  /** The target does not exist on disk. A named absence, never a guess. */
  MISSING_FILE = 'MISSING_FILE',
  /** The target exists and is not JavaScript: `.json`, `.node`, a `.d.ts`. */
  NOT_JAVASCRIPT = 'NOT_JAVASCRIPT',
  /**
   * The target exists, is JavaScript, and this parse did not walk it: a build
   * directory of a package that is not a walk root, or a file the walk excluded.
   */
  NOT_STAGED = 'NOT_STAGED',
  /** A subpath pattern (`"./features/*"`): one row stands for a family, unresolvable to one module. */
  PATTERN = 'PATTERN',
  /** `"./internal/*": null`: the subpath is deliberately unexported. */
  BLOCKED = 'BLOCKED',
}
