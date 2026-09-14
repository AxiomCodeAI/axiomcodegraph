/**
 * Where a type declaration sits, structurally.
 *
 * Answers "what encloses this declaration" without a line-range trick.
 * `ts_type` also carries explicit `enclosingTypeLinkHash` and
 * `enclosingMethodLinkHash` FKs; this column is the cheap categorical form of
 * the same fact, so a rule can filter before it joins.
 *
 * ## Examples
 *
 * ```ts
 * class Top { }                              // TOP_LEVEL_PLACEMENT
 * namespace N { class Inner { } }            // NAMESPACE_PLACEMENT
 * class Outer { }                            // (a nested type inside a class →
 *                                            //  NESTED_PLACEMENT)
 * function make() { interface Local { } }    // LOCAL_PLACEMENT
 * const W = class { };                       // EXPRESSION_PLACEMENT
 * declare module "pkg" { interface X { } }   // AMBIENT_MODULE_PLACEMENT
 * ```
 *
 * Schema §4.2 c6.
 */
export enum TsTypePlacement {
  /** Directly at the top level of a file. */
  TOP_LEVEL_PLACEMENT = 'TOP_LEVEL_PLACEMENT',

  /** Inside a `namespace` or `module` block. */
  NAMESPACE_PLACEMENT = 'NAMESPACE_PLACEMENT',

  /** Inside another type declaration. */
  NESTED_PLACEMENT = 'NESTED_PLACEMENT',

  /** Inside a function body or a block — a local type. */
  LOCAL_PLACEMENT = 'LOCAL_PLACEMENT',

  /** A class expression: declared in an expression position. */
  EXPRESSION_PLACEMENT = 'EXPRESSION_PLACEMENT',

  /** Inside `declare module "x" { … }`. */
  AMBIENT_MODULE_PLACEMENT = 'AMBIENT_MODULE_PLACEMENT',
}
