/**
 * The form of an import statement.
 *
 * From-imports outnumber module-imports 6:1 in the measured corpus and **38% of
 * from-imports are relative**, so relative resolution is mandatory rather than
 * an edge case.
 *
 * ## One row per BOUND NAME
 *
 * This is the rule that decides row counts, and it is about what lands in the
 * namespace rather than what is written:
 *
 * ```python
 * import a.b.c            # ONE row: binds only `a`
 * import a.b as ab        # ONE row: binds `ab`
 * from m import x, y      # TWO rows: binds `x` and `y`
 * from . import sibling    # ONE row, relativeLevel=1
 * from .mod import *       # ONE row, RELATIVE_WILDCARD, binds nothing knowable
 * ```
 *
 * ## Naming
 *
 * `FROM_WILDCARD` / `RELATIVE_WILDCARD` follow Python's own term — the Python
 * Language Reference calls `from x import *` a *wildcard* import — and the
 * neutral Souffle projection is `import_wildcard`, which is what Java's
 * `TYPE_ON_DEMAND` projects to as well. The fact layer follows the language; the
 * projection layer is shared.
 *
 * Schema v6 §2.14 c0.
 */
export enum PythonImportKind {
  /** `import os`. */
  MODULE_IMPORT = 'MODULE_IMPORT',

  /** `import numpy as np`. */
  MODULE_IMPORT_ALIAS = 'MODULE_IMPORT_ALIAS',

  /** `from m import x`. */
  FROM_MEMBER = 'FROM_MEMBER',

  /** `from m import x as y`. */
  FROM_MEMBER_ALIAS = 'FROM_MEMBER_ALIAS',

  /** `from m import *` — a soundness hole, marked rather than expanded. */
  FROM_WILDCARD = 'FROM_WILDCARD',

  /** `from .m import x` — 38% of from-imports. */
  RELATIVE_MEMBER = 'RELATIVE_MEMBER',

  /** `from .m import *`. */
  RELATIVE_WILDCARD = 'RELATIVE_WILDCARD',

  /** `from __future__ import annotations` — changes annotation semantics. */
  FUTURE = 'FUTURE',

  /** `importlib.import_module(...)` / `__import__(...)`. */
  DYNAMIC = 'DYNAMIC',
}
