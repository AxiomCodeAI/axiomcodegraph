/**
 * Modifiers on a function-shaped declaration. A comma-set column, sorted.
 *
 * ## Examples
 *
 * ```ts
 * class C {
 *     static async *gen() { }        // ASYNC,GENERATOR,STATIC
 *     abstract run(): void;          // ABSTRACT
 *     override handle() { }          // OVERRIDE
 *     optional?(): void;             // OPTIONAL
 * }
 * export default function main() { } // DEFAULT_EXPORT,EXPORT
 * declare function ambient(): void;  // DECLARE
 * ```
 *
 * `OPTIONAL` and `ABSTRACT` both imply the declaration may have no body, which
 * `ts_method.bodyPresence` records separately and more precisely — this column
 * says what was written, that one says what it means for the call graph.
 *
 * Schema §4.6 c11.
 */
export enum TsMethodModifier {
  /** `static`. */
  STATIC = 'STATIC',

  /** `abstract` — no body, and the subclass must supply one. */
  ABSTRACT = 'ABSTRACT',

  /** `async` — the declared return type is wrapped in a promise. */
  ASYNC = 'ASYNC',

  /** `function*` or `*m()` — returns a generator. */
  GENERATOR = 'GENERATOR',

  /** `declare` — asserts an existing function and emits nothing. */
  DECLARE = 'DECLARE',

  /** `override` — asserts a base member exists. */
  OVERRIDE = 'OVERRIDE',

  /** `m?()` — the member may be absent, which changes structural satisfaction. */
  OPTIONAL = 'OPTIONAL',

  /** `export`. */
  EXPORT = 'EXPORT',

  /** `export default`. */
  DEFAULT_EXPORT = 'DEFAULT_EXPORT',
}
