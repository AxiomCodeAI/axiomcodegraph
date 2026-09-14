/**
 * The dialect detected for a file — a **detection / rejection** signal, not a
 * semantics selector.
 *
 * Python 2 is out of scope (schema v6 §6). The hazard this enum exists to close
 * is that `tree-sitter-python@0.21.0` parses Python 2 **without erroring**: it
 * carries first-class `print_statement`, `exec_statement` and `chevron` nodes,
 * so `print "x"` produces a clean tree with `hasError === false` and a full,
 * confident, plausible-looking fact set whose scoping semantics we are not
 * applying. Absence of support is not the same as rejection, so a Py2 file must
 * be detected and rejected explicitly.
 *
 * ## Examples
 *
 * ```python
 * print("x")          # PY3
 * print "x"           # PY2_DETECTED_REJECTED  (print_statement)
 * except E, e:        # PY2_DETECTED_REJECTED  (two-identifier except_clause)
 * def f((a, b)):      # PY2_DETECTED_REJECTED  (tuple_pattern in parameters)
 * x = `repr`          # PY2_DETECTED_REJECTED  (raw-source backtick scan)
 * ```
 *
 * Schema v6 §2.1 c9, §6.2.
 */
export enum PythonDialect {
  /** Parsed as Python 3; facts are emitted. */
  PY3 = 'PY3',

  /** A Python-2-only construct was found. **No facts are emitted** for the module. */
  PY2_DETECTED_REJECTED = 'PY2_DETECTED_REJECTED',

  /** Dialect could not be established (unreadable or unparseable source). */
  PY_UNKNOWN = 'PY_UNKNOWN',
}
