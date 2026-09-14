/**
 * Which keyword declared a variable.
 *
 * Not cosmetic: the keyword decides which SYMBOL TABLE the declaration lands in,
 * and therefore what merges with what. `var` is function-scoped, everything else
 * is block-scoped — which is why the binder maintains two tables and why two
 * `const x` in sibling blocks of one function are two symbols while two `var x`
 * are one.
 *
 * ```ts
 * const a = 1;                       // CONST
 * let b = 1;                         // LET
 * var c = 1;                         // VAR   — function-scoped
 * using d = open();                  // USING       — disposed at scope exit (TS 5.2)
 * await using e = openAsync();        // AWAIT_USING — awaited disposal
 * try { } catch (f) { }              // CATCH
 * for (const g of xs) { }            // FOR_OF
 * for (const h in o) { }             // FOR_IN
 * for (let i = 0; …) { }             // FOR_INIT
 * ```
 *
 * `USING` and `AWAIT_USING` are TypeScript 5.2's analogue of try-with-resources:
 * the binding is disposed when its scope exits, which is a real control-flow fact
 * that `ts_block.resourceCount` also records.
 *
 * Schema §4.11 c16.
 */
export enum TsVariableDeclarationKind {
  /** `const` — block-scoped, not reassignable. */
  CONST = 'CONST',
  /** `let` — block-scoped. */
  LET = 'LET',
  /** `var` — FUNCTION-scoped, and therefore in a different symbol table. */
  VAR = 'VAR',
  /** `using` — disposed at scope exit. */
  USING = 'USING',
  /** `await using` — awaited disposal at scope exit. */
  AWAIT_USING = 'AWAIT_USING',
  /** A `catch (e)` binding. tsc's node for this IS a VariableDeclaration. */
  CATCH = 'CATCH',
  /** A `for…of` binding. */
  FOR_OF = 'FOR_OF',
  /** A `for…in` binding. */
  FOR_IN = 'FOR_IN',
  /** A `for (…;…;…)` initializer binding. */
  FOR_INIT = 'FOR_INIT',
}
