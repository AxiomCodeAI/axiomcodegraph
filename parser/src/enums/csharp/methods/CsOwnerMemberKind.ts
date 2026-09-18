/**
 * What an accessor belongs to — `cs_method.ownerMemberKind`.
 *
 * Paired with `ownerMemberLinkHash`, which is **required**: non-empty exactly
 * when `isAccessor` is true, empty otherwise. The kind disambiguates which
 * relation the hash points into, since `cs_property` and `cs_event` are
 * different tables.
 *
 * `INDEXER` is separate from `PROPERTY` even though an indexer IS a property
 * with parameters, because the two differ in how they are invoked: `x.P` against
 * `x[i]`. The `cs_property` row they point at carries `isIndexer` too, and the
 * duplication is deliberate — a rule over `cs_method` alone should not have to
 * join to learn it.
 */
export enum CsOwnerMemberKind {
  PROPERTY = 'PROPERTY',
  INDEXER = 'INDEXER',
  EVENT = 'EVENT',

  /** Not an accessor. `ownerMemberLinkHash` is empty. */
  NONE = 'NONE',
}
