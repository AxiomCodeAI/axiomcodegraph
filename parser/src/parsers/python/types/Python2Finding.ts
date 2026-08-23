import { PythonDialect } from '@/enums/python/modules';

/**
 * A single Python-2 construct found in a file, carrying the span needed to
 * record it as a `py_parse_gap` row.
 *
 * The span matters as much as the construct: a rejection that says only "this
 * file is Python 2" is not auditable, and the whole point of the rejection path
 * is that it names exactly what was found and where.
 */
export interface Python2Finding {
  /** The offending node type, or a synthetic name for raw-source findings. */
  construct: string;
  /**
   * Which detection tier found it.
   *
   * - `1` — a node type only Python 2 has (`print_statement`, `exec_statement`, `chevron`)
   * - `2` — a Python-2-only *shape* of a node type that is legal in Python 3
   * - `3` — invisible in the tree; found only by scanning raw source
   */
  tier: 1 | 2 | 3;
  /** 1-based line, matching CPython's `ast` and every position column. */
  startLine: number;
  /** 0-based column. */
  startColumn: number;
  endLine: number;
  endColumn: number;
  /** The offending source text, normalized to a single line. */
  sourceText: string;
}

/** The outcome of dialect detection for one file. */
export interface DialectDetectionResult {
  dialect: PythonDialect;
  /** Every finding, in source order. Empty when the file is Python 3. */
  findings: Python2Finding[];
}
