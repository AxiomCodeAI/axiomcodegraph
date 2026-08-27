/**
 * What kind of value-shaped member a `ts_field` row describes.
 *
 * ## Examples
 *
 * ```ts
 * class C {
 *     name: string;                 // PROPERTY_DECLARATION
 *     accessor count = 0;           // AUTO_ACCESSOR — a getter/setter pair plus storage
 *     constructor(private r: R) { } // PARAMETER_PROPERTY — declared by a parameter
 * }
 * interface I {
 *     readonly id: string;          // PROPERTY_SIGNATURE   isTypeOnly = true
 *     [key: string]: unknown;       // INDEX_SIGNATURE
 * }
 * const o = { a: 1 };               // OBJECT_LITERAL_PROPERTY
 * ```
 *
 * ## INDEX_SIGNATURE is a live resolution path, not a curiosity
 *
 * 126 measured, and a call through one resolved to a `FunctionType` in the
 * measurement — so `handler[name]()` has a real target. `indexKeyTypeName`
 * carries the key type because `[k: string]` and `[k: symbol]` admit different
 * accesses.
 *
 * Schema §4.8 c13.
 */
export enum TsMemberKind {
  /** `x: T` on a class. Has runtime existence. */
  PROPERTY_DECLARATION = 'PROPERTY_DECLARATION',

  /** `x: T` on an interface or type literal. Type-only. */
  PROPERTY_SIGNATURE = 'PROPERTY_SIGNATURE',

  /** `[k: string]: T` — admits members this relation cannot enumerate. */
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',

  /** Declared by `constructor(private x: T)`. Links back via `originParameterLinkHash`. */
  PARAMETER_PROPERTY = 'PARAMETER_PROPERTY',

  /** `{ a: 1 }` — a property of an object literal. */
  OBJECT_LITERAL_PROPERTY = 'OBJECT_LITERAL_PROPERTY',

  /** `accessor x = 1` — a getter/setter pair with backing storage. */
  AUTO_ACCESSOR = 'AUTO_ACCESSOR',
}
