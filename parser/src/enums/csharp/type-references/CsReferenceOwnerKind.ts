/**
 * Which relation `cs_type_reference.ownerLinkHash` points into.
 *
 * The hash spaces do not overlap — every prefix is distinct — but a join still
 * has to know which table to look in, and a rule that guessed from the context
 * column would break the moment a context became reachable from two owners.
 */
export enum CsReferenceOwnerKind {
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  METHOD_PARAMETER = 'METHOD_PARAMETER',
  PROPERTY = 'PROPERTY',
  EVENT = 'EVENT',
  FIELD = 'FIELD',
  TYPE_PARAMETER = 'TYPE_PARAMETER',
  VARIABLE = 'VARIABLE',
  EXPRESSION = 'EXPRESSION',
  ATTRIBUTE = 'ATTRIBUTE',
  USING = 'USING',
}
