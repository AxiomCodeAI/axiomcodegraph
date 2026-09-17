/**
 * Declared accessibility of a type or member — `cs_type.typeAccess` and the
 * `…Access` columns on methods, properties, events and fields.
 *
 * ## Why `NONE` exists and is not `PRIVATE`
 *
 * An **explicit interface implementation** — `void IFoo.Bar() { }` — has no
 * accessibility modifier at all, and it is not private: it is callable through
 * the interface and not through the type. 4,733 explicit interface specifiers
 * were measured. Recording it as `PRIVATE` would tell an engine the member is
 * unreachable from outside the type, which is exactly backwards.
 *
 * ## Why the C# default is not filled in here
 *
 * C#'s default accessibility depends on where the declaration sits: `internal`
 * for a top-level type, `private` for a class member, `public` for an interface
 * member, `public` for an enum member. The extractor applies that rule and emits
 * the resulting value, because it is syntactic and local. What it does NOT do is
 * emit `DEFAULT` and leave the engine to re-derive it from a placement column.
 */
export enum CsTypeAccess {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  INTERNAL = 'INTERNAL',

  /** `protected internal` — accessible to the assembly OR to a derived type. */
  PROTECTED_INTERNAL = 'PROTECTED_INTERNAL',

  /** `private protected` — accessible to a derived type WITHIN the assembly. */
  PRIVATE_PROTECTED = 'PRIVATE_PROTECTED',

  /**
   * No accessibility, and none implied: an explicit interface implementation.
   *
   * Not a synonym for private. 4,733 sites.
   */
  NONE = 'NONE',
}
