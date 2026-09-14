/**
 * A directive a comment carries, when it carries one. Schema §3.15 c6.
 *
 * `FLOW_PRAGMA` is the one with downstream consequences: it corroborates
 * `declaredTypeSource = SYNTACTIC_FLOW`, and without it a Flow annotation in
 * the AST is indistinguishable from a TypeScript one to a later reader — which
 * matters because `ts.createSourceFile` parses the overlapping grammar happily
 * and **mis-parses the rest silently**.
 */
export enum JsDirectiveKind {
  /** `'use strict'`. Decides whether an undeclared assignment binds or throws. */
  USE_STRICT = 'USE_STRICT',

  /** `@flow`. 6 files measured, and the reason `SYNTACTIC_FLOW` exists. */
  FLOW_PRAGMA = 'FLOW_PRAGMA',

  /** `// @ts-check`. Asks the compiler to typecheck this JavaScript file. */
  TS_CHECK = 'TS_CHECK',

  /** `// @ts-nocheck`. */
  TS_NOCHECK = 'TS_NOCHECK',

  /** `/* eslint … *\/`. */
  ESLINT = 'ESLINT',

  /** `//# sourceMappingURL=…`. Corroborating evidence that a file is generated. */
  SOURCE_MAP = 'SOURCE_MAP',

  /** Not a directive. */
  NONE = 'NONE',
}
