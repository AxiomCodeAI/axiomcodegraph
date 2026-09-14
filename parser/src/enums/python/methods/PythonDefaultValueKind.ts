/**
 * The shape of a parameter's default value.
 *
 * `isMutableDefault` is derived from this and is a standing finding: a list,
 * dict, set or call default is evaluated **once at definition time** and shared
 * across every call, which is one of Python's most common latent bugs.
 *
 * ```python
 * def f(items=[]): ...      # LIST — the same list on every call
 * def g(items=None): ...    # NONE_LITERAL — the correct idiom
 * ```
 *
 * Schema v6 §2.8 c15.
 */
export enum PythonDefaultValueKind {
  /** No default. */
  NONE = 'NONE',

  /** The literal `None`. */
  NONE_LITERAL = 'NONE_LITERAL',

  /** A string literal. */
  STRING = 'STRING',

  /** An int, float or complex literal. */
  NUMBER = 'NUMBER',

  /** `True` or `False`. */
  BOOL = 'BOOL',

  /** A list display — mutable, shared across calls. */
  LIST = 'LIST',

  /** A dict display — mutable, shared across calls. */
  DICT = 'DICT',

  /** A set display — mutable, shared across calls. */
  SET = 'SET',

  /** A tuple display — immutable. */
  TUPLE = 'TUPLE',

  /** A call, evaluated once at definition time. */
  CALL = 'CALL',

  /** A bare name, read at definition time. */
  NAME = 'NAME',

  /** A lambda. */
  LAMBDA = 'LAMBDA',

  /** `...` — the stub idiom. */
  ELLIPSIS = 'ELLIPSIS',

  /** Any other expression. */
  UNKNOWN = 'UNKNOWN',
}
