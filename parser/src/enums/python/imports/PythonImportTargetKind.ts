/**
 * What an import resolved to, **within the repo only**.
 *
 * `UNRESOLVED` is an honest negative: it means the parser did not find the
 * target in this analysis, not that the target does not exist. Deciding what is
 * external is the engine's job — the parser has no site-packages walk to do —
 * so `py_import.isExternalTarget` means precisely "did not resolve to a
 * `py_module` here".
 *
 * Schema v6 §2.14 c13.
 */
export enum PythonImportTargetKind {
  /** Resolved to a module in this analysis. */
  MODULE = 'MODULE',

  /** Resolved to a class. */
  TYPE = 'TYPE',

  /** Resolved to a function. */
  FUNCTION = 'FUNCTION',

  /** Resolved to a module-level variable. */
  VARIABLE = 'VARIABLE',

  /** Resolved to a package. */
  PACKAGE = 'PACKAGE',

  /** Not found in this analysis. The default, and an honest one. */
  UNRESOLVED = 'UNRESOLVED',

  /** More than one candidate, typically via a wildcard import. */
  AMBIGUOUS = 'AMBIGUOUS',
}
