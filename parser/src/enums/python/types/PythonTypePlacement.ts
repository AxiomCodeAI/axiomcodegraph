/**
 * Where a class is declared, which decides what can see it.
 *
 * `TYPE_CHECKING_PLACEMENT` is the one that produces findings: a class defined
 * only under `if TYPE_CHECKING:` **does not exist at runtime**, so instantiating
 * or subclassing it outside an annotation is a bug.
 *
 * ## Examples
 *
 * ```python
 * class Top: ...                  # TOP_LEVEL_PLACEMENT
 * class Outer:
 *     class Inner: ...            # NESTED_PLACEMENT
 * def f():
 *     class Local: ...            # LOCAL_PLACEMENT
 * if sys.platform == 'win32':
 *     class Impl: ...             # CONDITIONAL_PLACEMENT
 * if TYPE_CHECKING:
 *     class Stub: ...             # TYPE_CHECKING_PLACEMENT
 * ```
 *
 * Schema v6 §2.4 c6.
 */
export enum PythonTypePlacement {
  /** Directly at module level. */
  TOP_LEVEL_PLACEMENT = 'TOP_LEVEL_PLACEMENT',

  /** Inside another class body. */
  NESTED_PLACEMENT = 'NESTED_PLACEMENT',

  /** Inside a function — a fresh class object per call. */
  LOCAL_PLACEMENT = 'LOCAL_PLACEMENT',

  /** Inside an `if` / `try` at module level. */
  CONDITIONAL_PLACEMENT = 'CONDITIONAL_PLACEMENT',

  /** Under `if TYPE_CHECKING:` — absent at runtime. */
  TYPE_CHECKING_PLACEMENT = 'TYPE_CHECKING_PLACEMENT',
}
