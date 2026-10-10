/**
 * A simple selector, or the combinator between two compounds.
 *
 * `css_selector_part` is the selector as a sequence a consumer can JOIN on: a CLASS
 * part's `name` is what `html_class_reference.className` holds, an ID part's `name` is
 * what `html_element.id` holds, a TYPE part's `name` is `html_element.tagName`. The
 * combinator is a column on the part it precedes (`combinatorBefore`), not a part of
 * its own, so "the compound after a `>`" is one row and not a pair.
 */
export enum CssSelectorPartKind {
  /** `div`; a namespaced type (`svg|rect`) is the name `rect` with the prefix `svg|` as its value. */
  TYPE = 'TYPE',

  /** `*` */
  UNIVERSAL = 'UNIVERSAL',

  /** `.name` */
  CLASS = 'CLASS',

  /** `#name` */
  ID = 'ID',

  /** `[name]`, `[name=value i]` — `attributeMatcher` and `value` carry the rest. */
  ATTRIBUTE = 'ATTRIBUTE',

  /** `:hover`, `:nth-child(2n)`, `:not(.x)` — a functional one's argument selectors are child parts. */
  PSEUDO_CLASS = 'PSEUDO_CLASS',

  /** `::before`, `::part(name)`; also the legacy single-colon `:before`. */
  PSEUDO_ELEMENT = 'PSEUDO_ELEMENT',

  /** `&` — the parent rule's selector, in CSS nesting. */
  NESTING = 'NESTING',

  /**
   * A selector node of a kind this reader does not classify, kept as text in `value` so the
   * rule still has a row per selector it was written with.
   */
  RAW = 'RAW',
}

/** The combinator written BEFORE a compound. `NONE` on the first compound of a selector. */
export enum CssCombinator {
  NONE = 'NONE',

  /** whitespace */
  DESCENDANT = 'DESCENDANT',

  /** `>` */
  CHILD = 'CHILD',

  /** `+` */
  NEXT_SIBLING = 'NEXT_SIBLING',

  /** `~` */
  SUBSEQUENT_SIBLING = 'SUBSEQUENT_SIBLING',

  /** `||` */
  COLUMN = 'COLUMN',
}
