/**
 * What is being done to a name. Schema §3.10 c16.
 *
 * `READ_WRITE` exists for `x += 1` and `x++`, which do both — and collapsing it
 * into `WRITE` loses the read that a data-flow analysis needs, while collapsing
 * it into `READ` loses the write. `TYPEOF` is separate because
 * `typeof undeclared` is the one reference form that **does not throw** on an
 * unbound name, so an unresolved `TYPEOF` is not evidence of a missing binding.
 */
export enum JsReferenceKind {
  READ = 'READ',
  WRITE = 'WRITE',

  /** `x += 1`, `x++`. Both, and both are needed. */
  READ_WRITE = 'READ_WRITE',

  /** `delete obj.x`. Removes the property rather than reading or writing it. */
  DELETE = 'DELETE',

  /** `typeof x`. The only form that tolerates an unbound name. */
  TYPEOF = 'TYPEOF',
}
