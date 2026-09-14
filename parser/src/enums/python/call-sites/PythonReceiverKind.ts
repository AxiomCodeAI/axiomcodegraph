/**
 * The **syntactic shape** of a call's receiver.
 *
 * This is the schema's answer to duck typing: record the shape, and let the
 * engine do the typing. The measured distribution is why the enum is shaped
 * this way — of 39,000-odd attribute calls, the receiver is a bare `NAME` 50.7%
 * of the time, `SELF` 19.6%, an `ATTRIBUTE` chain 18.8%, and a `CALL_RESULT`
 * 7.3% (of which 28% are `super()`).
 *
 * Schema v6 §2.16 c4.
 */
export enum PythonReceiverKind {
  /** No receiver — a bare call such as `f(x)`. */
  NONE = 'NONE',
  /** The receiver parameter of an instance method. */
  SELF = 'SELF',
  /** The receiver parameter of a classmethod. */
  CLS = 'CLS',
  /** `super()`. */
  SUPER = 'SUPER',
  /** A bare name — the highest-value case, resolvable through its binding. */
  NAME = 'NAME',
  /** An attribute chain such as `self.repo`. */
  ATTRIBUTE = 'ATTRIBUTE',
  /** The result of another call. */
  CALL_RESULT = 'CALL_RESULT',
  /** A subscript such as `items[0]`. */
  SUBSCRIPT = 'SUBSCRIPT',
  /** A literal, as in `"a,b".split(",")`. */
  LITERAL = 'LITERAL',
  /** A known module. */
  MODULE = 'MODULE',
  /** A known class, so the call is on the class rather than an instance. */
  TYPE = 'TYPE',
  /** Anything else. */
  UNKNOWN = 'UNKNOWN',
}
