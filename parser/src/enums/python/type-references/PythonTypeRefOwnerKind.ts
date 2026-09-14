/**
 * Discriminator for `py_type_reference.typeReferenceOwnerHash`.
 *
 * Invariant #1 resolves a polymorphic FK in the relation its discriminator
 * names, so this decides which table the owner hash is looked up in.
 *
 * Schema v6 §2.6 c16.
 */
export enum PythonTypeRefOwnerKind {
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  METHOD_PARAM = 'METHOD_PARAM',
  FIELD = 'FIELD',
  BINDING = 'BINDING',
  EXPRESSION = 'EXPRESSION',
  DECORATOR = 'DECORATOR',
  TYPE_BASE = 'TYPE_BASE',
  BLOCK = 'BLOCK',
}
