/**
 * What the grammar could not represent, or represented wrongly.
 *
 * This relation RECORDS a gap and never repairs it. That is the whole design:
 * v3 had a source-rewriter and an edit-audit table so positions could be mapped
 * back, and §6.2(a) cancelled it because tree-sitter already parses 99.59% of
 * the CPython 2.7 stdlib unaided — putting every position in the fact table
 * behind a mapping to recover 0.41% of files is the wrong trade.
 *
 * Schema v7 §2.19 c1.
 */
export enum PythonParseGapKind {
  /** `exec tmpl % (a,)` — the only measured real grammar gap. */
  EXEC_COMPLEX_EXPR = 'EXEC_COMPLEX_EXPR',
  /** A Python 2-only node type; the module is rejected wholesale (§6.2). */
  PY2_CONSTRUCT_DETECTED = 'PY2_CONSTRUCT_DETECTED',
  /** tree-sitter flagged an ERROR node. */
  ERROR_NODE = 'ERROR_NODE',
  /** tree-sitter inserted a MISSING node to recover. */
  MISSING_NODE = 'MISSING_NODE',
}
