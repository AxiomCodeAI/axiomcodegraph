/**
 * The three block types CPython's symbol table distinguishes.
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
}
