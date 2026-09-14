/**
 * Operator fixity for unary operations.
 *
 * Python has **no postfix operators** — there is no `x++` — so `PREFIX` and
 * `NONE` are the only possibilities. The column exists for parity with Java,
 * where postfix increment is real.
 *
 * Schema v6 §2.15 c12.
 */
export enum PythonUnaryFixity {
  PREFIX = 'PREFIX',
  NONE = 'NONE',
}
