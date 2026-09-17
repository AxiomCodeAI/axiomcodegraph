/**
 * What kind of comment a `cs_comment` row records.
 *
 * ## XML doc is NOT a declared-type channel in C#
 *
 * This is the difference from JavaScript, where JSDoc is the only place a type
 * is written and dropping it loses the type. C# has declaration-site types, so
 * `<param name="x">` is documentation ABOUT a parameter whose type is already a
 * fact. `xmlDocTags` therefore carries the tag NAMES and not their contents:
 * enough to answer "is this documented", not pretending to be a type source.
 *
 * `<inheritdoc/>` is the one tag with semantics an engine may care about, and
 * it is in the tag set for that reason.
 */
export enum CsCommentKind {
  LINE = 'LINE',
  BLOCK = 'BLOCK',
  /** `/// …` */
  XML_DOC_LINE = 'XML_DOC_LINE',
  /** `/** … *\/` */
  XML_DOC_BLOCK = 'XML_DOC_BLOCK',
}
