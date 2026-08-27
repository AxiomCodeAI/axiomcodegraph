/**
 * The symbol-table prefixes that make declaration merging computable.
 *
 * ## The problem this solves
 *
 * `name -> single entity` is FALSE in TypeScript. 1,986 symbols in the measured
 * corpus have more than one declaration and one has 43; merging crosses
 * declaration kinds (class+interface, function+namespace) and crosses files.
 * So a primary key cannot be a name, and the merged entity needs an identity of
 * its own.
 *
 * TypeScript's own rule is that a symbol IS a `(symbol table, escaped name)`
 * pair and merging IS "same table, same name". These prefixes name the table
 * syntactically, so `declarationGroupKey = md5(mergeScopeKey ‖ escapedName)`
 * reproduces the binder's answer by construction rather than by approximation.
 *
 * ## Every member except GLOBAL is a PREFIX
 *
 * They are followed by `:` and a hash. `GLOBAL` is a whole value: there is only
 * one global scope, which is exactly why two scripts' declarations merge.
 *
 * ## Worked example
 *
 * ```ts
 * // a.ts — a module (it exports)
 * export interface Shape { area(): number }   // MODULE_EXPORTS:<a.ts hash>
 * interface Hidden { x: number }              // MODULE_LOCALS:<a.ts hash>
 *
 * // b.ts
 * declare module "./a" {
 *     interface Shape { extra: boolean }      // MODULE_EXPORTS:<a.ts hash>  ← merges
 * }
 * namespace Geometry {
 *     export type Path = Point[];             // NS:<Geometry group key>
 *     type Internal = number;                 // LOCALS:<module block hash>
 * }
 * function outer() {
 *     interface Local { y: number }           // LOCALS:<function scope hash>
 * }
 * ```
 *
 * Two facts fall out of that example and both were measured:
 *
 * - `Shape` in `a.ts` and `Shape` inside the augmentation share a table, so they
 *   are ONE type. That is why the augmentation's key uses the RESOLVED target
 *   module, and why `ts.resolveModuleName` being parser-legal matters to the KEY
 *   and not only to `ts_import`.
 * - Exported and non-exported declarations of one name are TWO symbols. tsc
 *   rejects mixing them (TS2395), which is the evidence that the tables really
 *   are separate — and the reason each scope carries two keys, not one.
 *
 * Schema §3.1, §4.2 c16.
 */
export enum TsMergeScopePrefix {
  /** Exported from a module file — the module symbol's `exports` table. */
  MODULE_EXPORTS = 'MODULE_EXPORTS',

  /** Declared but not exported — the source file's `locals` table. */
  MODULE_LOCALS = 'MODULE_LOCALS',

  /**
   * A global script, `declare global`, or an ambient module declaration.
   *
   * A whole value with no suffix, unlike every other member.
   */
  GLOBAL = 'GLOBAL',

  /**
   * Exported from a namespace, keyed by the NAMESPACE's own group key.
   *
   * Keyed on the group rather than the declaration so a member survives its
   * namespace merging with a class, a function or an enum of the same name.
   */
  NS = 'NS',

  /**
   * Inside a function body or a block, keyed by the BINDER SCOPE.
   *
   * The schema writes this as `LOCALS:<tsMethodLinkHash>`; the parser keys it on
   * the scope instead. Keying on the method merges two same-named block-scoped
   * declarations inside one function into a single symbol, which tsc does not
   * do — so the coarser key fails the very partition gate the formula exists to
   * pass. The scope hash derives from the module hash and the scope node's byte
   * range, so it is stable across runs and independent of traversal order.
   */
  LOCALS = 'LOCALS',
}
