/**
 * The shape of a call site.
 *
 * `py_call_site` is a **base** relation for Python where Java derives it in
 * `call-site.dl`, because the call shape is not recoverable from one positional
 * pattern: keyword arguments, `*`/`**` spreading, chained receivers, `super()`,
 * and — the point — the receiver's *syntactic* shape, which is all we honestly
 * know about a duck-typed receiver.
 *
 * ## `SUPER_CALL` is not virtual dispatch
 *
 * 98% of `super()` uses are `super().m()`. Python's `super()` performs an
 * MRO-ordered lookup starting **after** the enclosing class, so the enclosing
 * type is the slice point and `py_type_base.position` gives the order. Treating
 * it as ordinary dispatch finds the wrong method in any diamond.
 *
 * Schema v6 §2.16 c0.
 */
export enum PythonCallKind {
  /** `f(x)` — a bare name called. */
  SIMPLE_CALL = 'SIMPLE_CALL',

  /** `obj.m(x)`. */
  METHOD_CALL = 'METHOD_CALL',

  /** `a.b().c()` — the receiver is itself a call result. */
  CHAINED_CALL = 'CHAINED_CALL',

  /** `super().m()` — MRO-ordered, sliced after the enclosing class. */
  SUPER_CALL = 'SUPER_CALL',

  /** `self.m()`. */
  SELF_CALL = 'SELF_CALL',

  /** `cls.m()`. */
  CLS_CALL = 'CLS_CALL',

  /** `mod.f()` where the receiver is a known module. */
  MODULE_CALL = 'MODULE_CALL',

  /** `d[k]()` — the callee came out of a subscript. */
  SUBSCRIPT_CALL = 'SUBSCRIPT_CALL',

  /** The callee is computed, so no static target exists. */
  DYNAMIC_CALL = 'DYNAMIC_CALL',

  /** A call written as a decorator. */
  DECORATOR_CALL = 'DECORATOR_CALL',

  /** An instance called via `__call__`. */
  INSTANCE_CALL = 'INSTANCE_CALL',

  /** A builtin such as `len` or `isinstance`. */
  BUILTIN_CALL = 'BUILTIN_CALL',

  /** The callee could not be characterised. Honest, not lazy. */
  UNKNOWN_CALLEE_CALL = 'UNKNOWN_CALLEE_CALL',
}
