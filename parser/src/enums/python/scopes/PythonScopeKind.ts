/**
 * The kind of a Python scope — a direct mirror of `symtable.SymbolTable`.
 *
 * This enum exists so the oracle can assert **set equality** with CPython
 * rather than eyeballing structure; it is the reason precision and recall are
 * well-defined for the scope relation at all.
 *
 * ## The non-obvious cases
 *
 * A scope is introduced by exactly eight syntactic forms. `def`, `async def`,
 * `class` and `lambda` are expected. The other four are comprehensions, which
 * are separate scopes on the `PY3_0_11` target:
 *
 * ```python
 * x = "outer"
 * squares = [x * x for x in values]   # COMPREHENSION_LIST — its own scope;
 *                                     # the inner `x` never touches the outer one
 * ```
 *
 * `CLASS` is **not** an enclosing scope for name resolution: a class body's
 * names are invisible to functions nested inside it, which is why the analysis
 * pass passes a class body's bindings to its children differently from a
 * function's.
 *
 * Schema v6 §2.2 c0.
 */
export enum PythonScopeKind {
  /** The module's own top-level scope. One per module, the root of the forest. */
  MODULE = 'MODULE',

  /** A `class` body. Bindings here are attributes, not closure-visible locals. */
  CLASS = 'CLASS',

  /** A `def` or `async def` body. */
  FUNCTION = 'FUNCTION',

  /** A `lambda` body. Named `lambda` by symtable, so two on one line collide without a column. */
  LAMBDA = 'LAMBDA',

  /** A list comprehension — symtable name `listcomp`. */
  COMPREHENSION_LIST = 'COMPREHENSION_LIST',

  /** A set comprehension — symtable name `setcomp`. */
  COMPREHENSION_SET = 'COMPREHENSION_SET',

  /** A dict comprehension — symtable name `dictcomp`. */
  COMPREHENSION_DICT = 'COMPREHENSION_DICT',

  /** A generator expression — symtable name `genexpr`. Keeps its scope in every regime. */
  GENERATOR_EXPRESSION = 'GENERATOR_EXPRESSION',

  /** PEP 695 type-parameter scope (3.12). Deferred — declared for forward parity. */
  TYPE_PARAM = 'TYPE_PARAM',

  /** PEP 695 `type` alias scope (3.12). Deferred — declared for forward parity. */
  TYPE_ALIAS = 'TYPE_ALIAS',

  /**
   * The scope CPython opens for a BOUNDED or CONSTRAINED type parameter (3.12+).
   *
   * `class C[T: int]` is three scopes deep, not two, and the middle one is a
   * distinct block type in CPython's own symtable — `get_type()` returns
   * `"TypeVar bound"`, not `"type parameter"`. Verified directly on 3.12.4:
   *
   * ```
   * class C[T]        module -> type parameter -> class
   * class C[T: int]   module -> type parameter -> TypeVar bound -> class
   * def f[T: (int, str)]()   module -> type parameter -> TypeVar bound -> function
   * ```
   *
   * The bound gets its own scope because it is EVALUATED LAZILY and can refer to
   * the type parameters around it, so it cannot share the wrapper's namespace.
   * A constrained parameter — the tuple form — opens it too, so this is not the
   * rare case it might look like: 18 occurrences in CPython's own PEP 695 tests.
   *
   * §2.2 anticipated TYPE_PARAM and TYPE_ALIAS but not this third scope. Merging
   * it into TYPE_PARAM would report a two-level nesting as flat and lose the
   * distinction between a name visible to the bound and one visible only to the
   * body.
   */
  TYPE_PARAM_BOUND = 'TYPE_PARAM_BOUND',

  /** PEP 649 deferred-annotation scope (3.14). Deferred — declared for forward parity. */
  ANNOTATION = 'ANNOTATION',
}
