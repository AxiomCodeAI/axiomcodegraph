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
  /**
   * The grammar applied a SOFT KEYWORD where it should not have, producing a
   * clean parse of a different statement.
   *
   * `type(obj).attr = value` -- the ordinary way to set an attribute on an
   * object's class -- is read as a PEP 695 type alias, because the leading
   * `type` is taken as the keyword and `(obj).attr` accepted as the alias name.
   * The `call` node is then absent from the tree entirely, so the callee has no
   * identifier node and NO py_call_site can be minted for it however the
   * statement is walked. The target, the value and any nested calls ARE
   * recoverable and are recovered; the outer call is not, and that is what this
   * row records.
   *
   * Disposition is MISPARSED_SILENTLY, not ERROR_NODE: nothing in the tree is
   * marked wrong, so without this row a consumer cannot tell a file where the
   * idiom appears from one where it does not.
   */
  SOFT_KEYWORD_MISPARSE = 'SOFT_KEYWORD_MISPARSE',

  ERROR_NODE = 'ERROR_NODE',
  /** tree-sitter inserted a MISSING node to recover. */
  MISSING_NODE = 'MISSING_NODE',
}
