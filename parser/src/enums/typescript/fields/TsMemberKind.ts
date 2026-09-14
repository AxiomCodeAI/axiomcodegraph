/**
 * What kind of value-shaped member a `ts_field` row describes.
 *
 * ## The owner-qualified values, and why they exist
 *
 * `PROPERTY_SIGNATURE` and `TYPE_LITERAL_PROPERTY` are the same syntax in
 * different places, and they differ in the ONE thing a consumer must not get
 * wrong: what `tsTypeLinkHash` points at. An interface member is owned by a
 * `ts_type`; a type-literal member is owned by a `ts_type_reference`, because an
 * anonymous shape has no declaration and §4.2 forbids inventing one.
 *
 * The enum was already built this way — `OBJECT_LITERAL_PROPERTY` and
 * `PARAMETER_PROPERTY` are owner-qualified too — so this is the existing pattern
 * applied consistently rather than a new mechanism. The prefixes make it
 * fail-safe: `TS_TYPE_…` and `TS_TYPE_REFERENCE_…` differ, so a rule joining
 * against `ts_type` finds NO match for a shape member rather than a wrong one.
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

  /** `x: T` on an INTERFACE. Type-only. Owned by a `ts_type`. */
  PROPERTY_SIGNATURE = 'PROPERTY_SIGNATURE',

  /** `[k: string]: T` on an INTERFACE — admits members this relation cannot enumerate. */
  INDEX_SIGNATURE = 'INDEX_SIGNATURE',

  /**
   * `x: T` inside an ANONYMOUS type literal — `{ x: T }`.
   *
   * Owner-qualified because the owner FK points somewhere else: `tsTypeLinkHash`
   * is a `ts_type_reference` here, not a `ts_type`, since an anonymous shape has
   * no declaration and §4.2 forbids inventing one. This column IS the
   * discriminator, so a rule that wants declared members only filters on it.
   */
  TYPE_LITERAL_PROPERTY = 'TYPE_LITERAL_PROPERTY',

  /** `[k: string]: T` inside an anonymous type literal. Owner is the shape. */
  TYPE_LITERAL_INDEX_SIGNATURE = 'TYPE_LITERAL_INDEX_SIGNATURE',

  /** Declared by `constructor(private x: T)`. Links back via `originParameterLinkHash`. */
  PARAMETER_PROPERTY = 'PARAMETER_PROPERTY',

  /** `{ a: 1 }` — a property of an object literal. */
  OBJECT_LITERAL_PROPERTY = 'OBJECT_LITERAL_PROPERTY',

  /** `accessor x = 1` — a getter/setter pair with backing storage. */
  AUTO_ACCESSOR = 'AUTO_ACCESSOR',
}
