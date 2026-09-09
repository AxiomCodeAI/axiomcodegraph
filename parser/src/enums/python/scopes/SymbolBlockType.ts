/**
 * The block types CPython's symbol table distinguishes.
 *
 * Worth stating explicitly because the mapping is not one-to-one with the
 * syntactic forms: **lambdas and all four comprehension forms are `FUNCTION`
 * blocks**. symtable gives them no type of their own, which is why
 * `SymbolTable.is_optimized()` returns true for a list comprehension, and why
 * the analysis pass treats a comprehension's locals as capturable exactly like a
 * function's.
 *
 * The `CLASS` / `FUNCTION` distinction is load-bearing in the other direction: a
 * class body's bindings are **not** visible to functions nested inside it, so a
 * class block contributes nothing to the `bound` set handed to its children.
 */
export enum SymbolBlockType {
  /** The module block. Exactly one per file, the root of the scope forest. */
  MODULE = 'module',

  /** A class body. Does not provide closure cells to nested scopes. */
  CLASS = 'class',

  /** A `def`, `async def`, `lambda`, or any comprehension. */
  FUNCTION = 'function',

  // ── PEP 695 annotation scopes, 3.12+ ──────────────────────────────────────
  // The strings are CPython's own `SymbolTable.get_type()` values, because that
  // is what this enum mirrors and what the oracle compares against.

  /**
   * The scope a type parameter list opens: `class C[T]` / `def f[U]` / `type A[W]`.
   *
   * It WRAPS the class or function scope rather than sitting inside it — symtable
   * nests the `class` block within this one — and it is where the parameter names
   * bind. With type parameters present a class's BASES and a function's DEFAULTS
   * are evaluated here too, which is what `.generic_base` and `.defaults` are in
   * CPython's own symbol list.
   */
  TYPE_PARAM = 'type parameter',

  /** The value scope of `type A = …`, nested inside TYPE_PARAM when generic. */
  TYPE_ALIAS = 'type alias',

  /** The bound of one parameter: the `int` in `class C[T: int]`. */
  TYPE_PARAM_BOUND = 'TypeVar bound',
}
