/**
 * Which front end produced the tree for a module, and whether it was complete.
 *
 * `TS_PYTHON3_PARTIAL` means at least one `py_parse_gap` row exists for the
 * module — the gap is recorded, never repaired, and positions stay measured
 * against the original source.
 *
 * Schema v6 §2.1 c12.
 */
export enum PythonGrammarUsed {
  /** `tree-sitter-python@0.21.0`, clean parse. */
  TS_PYTHON3 = 'TS_PYTHON3',

  /** Parsed, but with at least one recorded `py_parse_gap` (ERROR / MISSING node). */
  TS_PYTHON3_PARTIAL = 'TS_PYTHON3_PARTIAL',

  /** No usable tree — the module was rejected or unreadable. */
  UNPARSED = 'UNPARSED',
}
