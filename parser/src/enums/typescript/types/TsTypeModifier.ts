/**
 * Modifiers on a type declaration. A comma-set column, sorted at emit.
 *
 * Sorted so the value does not depend on the order the modifiers were written
 * in — `export abstract class` and `abstract export class` are the same fact,
 * and a rule matching on the string must not have to know which was typed.
 *
 * ## Examples
 *
 * ```ts
 * export abstract class Base<T> { }   // ABSTRACT,EXPORT,GENERIC
 * declare class Ambient { }           // DECLARE
 * export default class Widget { }     // DEFAULT_EXPORT,EXPORT
 * const enum Direction { Up }         // CONST
 * ```
 *
 * Schema §4.2 c5.
 */
export enum TsTypeModifier {
  /** `abstract class` — cannot be constructed directly. */
  ABSTRACT = 'ABSTRACT',

  /** `declare` — the declaration asserts an existing entity and emits nothing. */
  DECLARE = 'DECLARE',

  /** `const enum` — members are inlined at use sites. */
  CONST = 'CONST',

  /** `export` is present. */
  EXPORT = 'EXPORT',

  /** `export default` is present. */
  DEFAULT_EXPORT = 'DEFAULT_EXPORT',

  /** The declaration has at least one type parameter. */
  GENERIC = 'GENERIC',
}
