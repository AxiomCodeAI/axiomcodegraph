/**
 * What kind of callable a `def`, `async def`, or `lambda` produces.
 *
 * The two synthetic values are the load-bearing ones. Python allows executable
 * code at module level and in class bodies, where Java does not, but the
 * resolution layer requires every expression to reach *some* method or call
 * attribution fails. So a synthetic `<module>` and `<classbody>` method are
 * minted, exactly as the Java parser already mints `<clinit>` / `<init>` for
 * initializer blocks. Measured: 3,006 executable module-level statements across
 * 826 files.
 *
 * ## Examples
 *
 * ```python
 * def helper(): ...              # FUNCTION
 * class K:
 *     def m(self): ...           # INSTANCE_METHOD
 *     @staticmethod
 *     def s(): ...               # STATIC_METHOD
 *     @classmethod
 *     def c(cls): ...            # CLASS_METHOD
 *     @property
 *     def p(self): ...           # PROPERTY_GETTER — turns a read into a call
 *     def __init__(self): ...    # CONSTRUCTOR
 *     def __new__(cls): ...      # ALLOCATOR
 * @overload
 * def f(x: int) -> int: ...      # OVERLOAD_STUB — a declaration, never a target
 * ```
 *
 * Schema v6 §2.7 c16.
 */
export enum PythonMethodKind {
  /** A module-level function. */
  FUNCTION = 'FUNCTION',

  /** A method taking an instance receiver. */
  INSTANCE_METHOD = 'INSTANCE_METHOD',

  /** A `@staticmethod` — no receiver, so argument positions do not shift. */
  STATIC_METHOD = 'STATIC_METHOD',

  /** A `@classmethod` — receiver is the class. */
  CLASS_METHOD = 'CLASS_METHOD',

  /** A `@property` getter: `obj.x` becomes a call, not an attribute read. */
  PROPERTY_GETTER = 'PROPERTY_GETTER',

  /** A `@x.setter`. */
  PROPERTY_SETTER = 'PROPERTY_SETTER',

  /** A `@x.deleter`. */
  PROPERTY_DELETER = 'PROPERTY_DELETER',

  /** `__init__`. */
  CONSTRUCTOR = 'CONSTRUCTOR',

  /** `__new__` — runs before `__init__` and can return another type entirely. */
  ALLOCATOR = 'ALLOCATOR',

  /** Any other dunder method. */
  DUNDER_METHOD = 'DUNDER_METHOD',

  /** Decorated `@abstractmethod` — the concrete target is in an implementor. */
  ABSTRACT_METHOD = 'ABSTRACT_METHOD',

  /** An `@overload` signature. `bodyIsStub` is true; never a call target. */
  OVERLOAD_STUB = 'OVERLOAD_STUB',

  /** A `lambda`. */
  LAMBDA = 'LAMBDA',

  /** A function defined inside another function — 5.3% of functions. */
  NESTED_FUNCTION = 'NESTED_FUNCTION',

  /** Contains `yield`, so calling it returns a generator rather than running it. */
  GENERATOR = 'GENERATOR',

  /** An `async def`. Calling it returns a coroutine. */
  ASYNC_FUNCTION = 'ASYNC_FUNCTION',

  /** An `async def` containing `yield`. */
  ASYNC_GENERATOR = 'ASYNC_GENERATOR',

  /** Synthetic `<module>` initializer — owns all module-level code. */
  MODULE_INITIALIZER = 'MODULE_INITIALIZER',

  /** Synthetic `<classbody>` initializer — owns all class-body code. */
  CLASS_INITIALIZER = 'CLASS_INITIALIZER',
}
