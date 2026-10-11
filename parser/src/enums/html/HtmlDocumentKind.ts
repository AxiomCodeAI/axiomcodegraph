/**
 * Whether a file is a whole page or a piece of one.
 *
 * A template engine's partial (`_header.html`, a Django `include`) has no `<html>`,
 * no `<head>` and usually no doctype. A browser would wrap it in implied elements; the
 * grammar does not, so a fragment's top-level elements have no parent row, and this
 * column is how a consumer tells a page from a piece of one.
 */
export enum HtmlDocumentKind {
  /** The source writes `<html>`, a doctype, or both. */
  DOCUMENT = 'DOCUMENT',

  /** Neither is written: a partial, a component template, a snippet. */
  FRAGMENT = 'FRAGMENT',
}
