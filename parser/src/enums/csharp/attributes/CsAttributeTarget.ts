/**
 * The explicit target of an attribute — `cs_attribute.attributeTarget`.
 *
 * ## The target changes WHAT the attribute is attached to, not where it is written
 *
 * `[return: NotNull]` on a method attaches to the RETURN VALUE, not the method.
 * `[field: NonSerialized]` on an auto-property attaches to the compiler-generated
 * backing field, which has no declaration syntax anywhere. Dropping the target
 * makes both read as attributes on the enclosing declaration, which is a
 * different fact.
 *
 * `NONE` is the common case and means "attached to whatever it is written on",
 * which is not the same as unknown.
 */
export enum CsAttributeTarget {
  NONE = 'NONE',
  ASSEMBLY = 'ASSEMBLY',
  MODULE = 'MODULE',
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  FIELD = 'FIELD',
  PROPERTY = 'PROPERTY',
  EVENT = 'EVENT',
  PARAM = 'PARAM',
  RETURN = 'RETURN',
  TYPEVAR = 'TYPEVAR',
}
