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

  /** PEP 649 deferred-annotation scope (3.14). Deferred — declared for forward parity. */
  ANNOTATION = 'ANNOTATION',
}
