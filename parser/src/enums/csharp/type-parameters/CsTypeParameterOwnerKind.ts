/**
 * What owns a type parameter — `cs_type_parameter.ownerKind`.
 *
 * One relation for both, with the owner's kind in a column, because the columns
 * are otherwise identical and a `where` clause reads the same on either. The
 * kind is needed to disambiguate the FK: `ownerLinkHash` points at a `cs_type`
 * row or a `cs_method` row, and the two hash spaces do not overlap but a join
 * still has to know which relation to look in.
 */
export enum CsTypeParameterOwnerKind {
  /** `class C<T>` — `ownerLinkHash` is a `cs_type`. */
  TYPE = 'TYPE',

  /** `void M<T>()` — `ownerLinkHash` is a `cs_method`. */
  METHOD = 'METHOD',
}
