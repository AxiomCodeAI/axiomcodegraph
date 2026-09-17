/**
 * What a piece of declaration-attached metadata belongs to.
 *
 * Shared by `cs_attribute.ownerKind` and `cs_comment.ownerKind`, because both
 * answer the same question and two enums with the same members drift. A pair
 * that can disagree is a pair a consumer resolves by reading whichever it saw
 * first.
 *
 * `MODULE` is not a fallback. `[assembly: InternalsVisibleTo("X")]` has **no
 * owner declaration at all** — it attaches to the assembly, and the file is the
 * only thing in the fact base that can hold it. A file-leading comment is the
 * same shape.
 */
export enum CsDeclarationOwnerKind {
  MODULE = 'MODULE',
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  METHOD_PARAMETER = 'METHOD_PARAMETER',
  PROPERTY = 'PROPERTY',
  EVENT = 'EVENT',
  FIELD = 'FIELD',
  ENUM_MEMBER = 'ENUM_MEMBER',
  TYPE_PARAMETER = 'TYPE_PARAMETER',
}
