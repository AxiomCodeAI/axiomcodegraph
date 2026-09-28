/** Which TypeScript module, if any, an entry's target was built from. `ts_package_entry` c6. */
export enum TsPackageEntryOutcome {
  /** The target IS a TypeScript file this parse walked; `targetModuleLinkHash` names it. */
  RESOLVED = 'RESOLVED',
  /**
   * The target is BUILD OUTPUT (`dist/esm/index.mjs`, `dist/index.d.ts`) and the
   * walked source module it was compiled from was found by the fixed convention in
   * `ts-package-entry-extractor.ts`; `targetModuleLinkHash` names that source.
   */
  RESOLVED_FROM_BUILD_OUTPUT = 'RESOLVED_FROM_BUILD_OUTPUT',
  /** No walked TypeScript module answers the target by either route. A named absence. */
  NO_SOURCE_MODULE = 'NO_SOURCE_MODULE',
  /**
   * A subpath pattern (`"./features/*"`) as written. It names no one module; each
   * walked module it publishes is a `RESOLVED_FROM_PATTERN` row of its own.
   */
  PATTERN = 'PATTERN',
  /** One module a subpath pattern publishes, with the `*` substituted on both sides. */
  RESOLVED_FROM_PATTERN = 'RESOLVED_FROM_PATTERN',
  /** `"./internal/*": null`: the subpath is deliberately unexported. */
  BLOCKED = 'BLOCKED',
}
