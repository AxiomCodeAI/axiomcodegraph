/**
 * What an export row exposes, and how.
 *
 * ## No Java analogue at all
 *
 * Java visibility is a modifier and there is no re-export. TypeScript needs this
 * relation because **a re-export chain is the only path from an importer to the
 * real declaration** — and there are 1,251 export declarations and 86
 * `export *` in the measured corpus. Python solved the same problem with
 * `__all__`, which is a weaker instrument: it lists names without saying where
 * they came from.
 *
 * ## Examples
 *
 * ```ts
 * export class C { }                    // INLINE_DECLARATION
 * export { a };                         // NAMED_EXPORT
 * export { a as b };                    // NAMED_ALIAS
 * export default class D { }            // DEFAULT_EXPORT
 * export default compute();             // DEFAULT_EXPRESSION
 * export * from "./m";                  // EXPORT_STAR
 * export * as ns from "./m";            // EXPORT_STAR_AS_NAMESPACE
 * export = Legacy;                      // EXPORT_ASSIGNMENT
 * export type { T };                    // TYPE_ONLY_NAMED
 * export type * from "./m";             // TYPE_ONLY_STAR
 * export import X = a.b.C;              // EXPORT_IMPORT_EQUALS
 * ```
 *
 * ## EXPORT_STAR is a real soundness surface
 *
 * It exports *everything* from the source module, and the set is not knowable
 * from the row alone — the engine expands it by joining the source module's
 * exports. Like Python's `import *`, but at **86 sites** rather than 22, so it
 * is not an edge case here.
 *
 * Schema §4.13 c2.
 */
export enum TsExportKind {
  /** `export class C` — the declaration and the export are one statement. */
  INLINE_DECLARATION = 'INLINE_DECLARATION',
  /** `export { a }` — exports a name declared elsewhere in the file. */
  NAMED_EXPORT = 'NAMED_EXPORT',
  /** `export { a as b }` — the importer sees `b`. */
  NAMED_ALIAS = 'NAMED_ALIAS',
  /** `export default class D` — bound under the reserved name `default`. */
  DEFAULT_EXPORT = 'DEFAULT_EXPORT',
  /** `export default compute()` — an expression, with no declaration to point at. */
  DEFAULT_EXPRESSION = 'DEFAULT_EXPRESSION',
  /** `export * from "./m"` — exports a set this row cannot name. */
  EXPORT_STAR = 'EXPORT_STAR',
  /** `export * as ns from "./m"` — the set arrives under one name. */
  EXPORT_STAR_AS_NAMESPACE = 'EXPORT_STAR_AS_NAMESPACE',
  /** `export = X` — the CommonJS whole-module form. */
  EXPORT_ASSIGNMENT = 'EXPORT_ASSIGNMENT',
  /** `export type { T }` — must create no call-graph edge. */
  TYPE_ONLY_NAMED = 'TYPE_ONLY_NAMED',
  /** `export type * from "./m"`. */
  TYPE_ONLY_STAR = 'TYPE_ONLY_STAR',
  /** `export import X = a.b.C`. */
  EXPORT_IMPORT_EQUALS = 'EXPORT_IMPORT_EQUALS',
}
