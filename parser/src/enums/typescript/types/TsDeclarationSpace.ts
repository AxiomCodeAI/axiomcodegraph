/**
 * Which MEANINGS a declaration occupies. A comma-set column.
 *
 * This is the column that explains why merging is legal in some combinations and
 * an error in others: two declarations may merge only when their spaces do not
 * collide. A class occupies TYPE and VALUE; an interface occupies TYPE alone; so
 * `class C` + `interface C` merges (28 such groups measured) while `class C` +
 * `class C` is an error. Without the spaces, the engine can group declarations
 * but cannot say what the group MEANS.
 *
 * ## Spaces by declaration
 *
 * ```ts
 * class C { }        // TYPE, VALUE
 * interface I { }    // TYPE
 * type A = number;   // TYPE
 * enum E { }         // TYPE, VALUE, NAMESPACE
 * namespace N { }    // NAMESPACE, and VALUE only when INSTANTIATED
 * function f() { }   // VALUE
 * const x = 1;       // VALUE
 * ```
 *
 * ## The namespace subtlety, and why it is not cosmetic
 *
 * ```ts
 * namespace Types {                  // NAMESPACE only — erased entirely
 *     export interface Point { x: number }
 * }
 * namespace Geometry {               // NAMESPACE, VALUE — emits an IIFE
 *     export const origin = { x: 0 };
 * }
 * ```
 *
 * A parser that treats every namespace as a value invents a runtime entity for
 * the erased ones; one that treats none as a value loses the real ones. tsc
 * decides it from the body alone, so it is decidable without a checker.
 *
 * Schema §4.2 c18, §3.1.
 */
export enum TsDeclarationSpace {
  /** Usable in a type position. */
  TYPE = 'TYPE',

  /** Exists at runtime and can be referenced from an expression. */
  VALUE = 'VALUE',

  /** Can be qualified with a dot to reach members: a namespace or an enum. */
  NAMESPACE = 'NAMESPACE',
}
