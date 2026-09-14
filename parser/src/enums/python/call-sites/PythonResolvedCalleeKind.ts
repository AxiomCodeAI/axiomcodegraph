/**
 * What the callee resolved to, parser-local best effort.
 *
 * `UNRESOLVED` is the **honest default**, and the engine overrides it with
 * cross-module knowledge. The parser deliberately stops at the module boundary:
 * resolution is decidable within one module and guesswork outside it.
 *
 * Schema v6 §2.16 c17.
 */
export enum PythonResolvedCalleeKind {
  /** A method of a class in this module. */
  METHOD = 'METHOD',
  /** A class — so the call constructs an instance. */
  TYPE = 'TYPE',
  /** A module-level function in this module. */
  MODULE_FUNCTION = 'MODULE_FUNCTION',
  /** A builtin. */
  BUILTIN = 'BUILTIN',
  /** Bound by an import; the target is outside this module. */
  IMPORTED = 'IMPORTED',
  /** Not resolved here. The default. */
  UNRESOLVED = 'UNRESOLVED',
}
