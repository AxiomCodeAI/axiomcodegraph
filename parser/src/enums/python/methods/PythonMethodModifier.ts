/**
 * Method modifiers, emitted as a comma-set.
 *
 * These are mostly decorator-derived, and decorators matter here in a way Java
 * annotations do not: a Python decorator is a function application that
 * **replaces** the decorated object. `@lru_cache def f()` means the name `f` now
 * holds a `functools._lru_cache_wrapper`, not the function.
 *
 * Schema v6 §2.7 c11.
 */
export enum PythonMethodModifier {
  /** `async def`. */
  ASYNC = 'ASYNC',

  /** Contains `yield` or `yield from`. */
  GENERATOR = 'GENERATOR',

  /** `@staticmethod`. */
  STATIC = 'STATIC',

  /** `@classmethod`. */
  CLASS = 'CLASS',

  /** `@property`. */
  PROPERTY = 'PROPERTY',

  /** `@x.setter`. */
  SETTER = 'SETTER',

  /** `@x.deleter`. */
  DELETER = 'DELETER',

  /** `@abstractmethod`. */
  ABSTRACT = 'ABSTRACT',

  /** `@overload`. */
  OVERLOAD = 'OVERLOAD',

  /** `@final`. */
  FINAL = 'FINAL',

  /** `@lru_cache` / `@cache` / `@cached_property`. */
  CACHED = 'CACHED',

  /** Minted by the parser rather than written in source. */
  SYNTHETIC = 'SYNTHETIC',
}
