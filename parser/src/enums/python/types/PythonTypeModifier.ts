/**
 * Class-level modifiers, emitted as a comma-set.
 *
 * The last four are **dispatch escape hatches** rather than descriptions: a
 * class defining `__getattr__` can answer for attributes that appear nowhere in
 * the source, so a resolver must know not to trust an "attribute not found"
 * conclusion about it. Measured at 1.8% of classes — rare enough to mark rather
 * than redesign around.
 *
 * Schema v6 §2.4 c5.
 */
export enum PythonTypeModifier {
  /** Has abstract methods or an ABC metaclass. */
  ABSTRACT = 'ABSTRACT',

  /** Decorated `@final`. */
  FINAL = 'FINAL',

  /** A frozen dataclass — instances are immutable. */
  FROZEN = 'FROZEN',

  /** Declares `__slots__`, so instances have no `__dict__`. */
  SLOTS = 'SLOTS',

  /** Parameterised with `Generic[...]`. */
  GENERIC = 'GENERIC',

  /** A `@runtime_checkable` Protocol. */
  RUNTIME_CHECKABLE = 'RUNTIME_CHECKABLE',

  /** Defines `__getattr__` — attribute lookup can succeed for unknown names. */
  HAS_GETATTR = 'HAS_GETATTR',

  /** Defines `__setattr__` — attribute writes are intercepted. */
  HAS_SETATTR = 'HAS_SETATTR',

  /** Defines `__call__` — instances are callable. */
  HAS_CALL = 'HAS_CALL',

  /** Instances are callable, so a "variable" may in fact be a call target. */
  /**
   * **NOT EMITTED — undefined as specified.**
   *
   * A class defines `__call__` if and only if its instances are callable, so
   * this and {@link HAS_CALL} are coextensive as the schema defines them and one
   * of the two is dead. The parser emits `HAS_CALL` alone rather than inventing a
   * distinction to justify keeping both.
   *
   * A0 owns the resolution: either drop this value, or redefine the pair as
   * `__call__` declared ON this class versus callable INCLUDING inherited —
   * both detectable (`in cls.__dict__` versus `hasattr`). Kept in the enum so
   * the schema and the code stay in step until that call is made.
   */
  CALLABLE_INSTANCE = 'CALLABLE_INSTANCE',
}
