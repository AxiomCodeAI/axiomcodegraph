/**
 * Decorators whose effect on the language is defined rather than user code.
 *
 * These change what the decorated name MEANS, so a consumer cannot treat them as
 * opaque. `@staticmethod` removes the receiver, which shifts every positional
 * parameter by one; `@property` turns an attribute read into a call;
 * `@contextmanager` turns a generator into a context manager.
 *
 * Schema v7 §2.12 c16.
 */
export enum PythonBuiltinDecoratorKind {
  STATICMETHOD = 'STATICMETHOD',
  CLASSMETHOD = 'CLASSMETHOD',
  PROPERTY = 'PROPERTY',
  SETTER = 'SETTER',
  DELETER = 'DELETER',
  ABSTRACTMETHOD = 'ABSTRACTMETHOD',
  OVERLOAD = 'OVERLOAD',
  FINAL = 'FINAL',
  CACHED_PROPERTY = 'CACHED_PROPERTY',
  LRU_CACHE = 'LRU_CACHE',
  DATACLASS = 'DATACLASS',
  CONTEXTMANAGER = 'CONTEXTMANAGER',
  WRAPS = 'WRAPS',
  /** Not a decorator the language defines. */
  NONE = 'NONE',
}
