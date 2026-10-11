/** Where a stylesheet's text came from. */
export enum CssStylesheetSource {
  /** A `.css` file. */
  FILE = 'FILE',

  /** A `<style>` element; `ownerHtmlElementLinkHash` names it and `filePath` is the page's. */
  HTML_STYLE_ELEMENT = 'HTML_STYLE_ELEMENT',
}

/**
 * Whether a stylesheet is source or a build's output.
 *
 * Labelled and emitted in full, never skipped: a bundle's rules are real rules, and a
 * consumer excludes them from a count by column. The JavaScript front end's rule.
 */
export enum CssSourceProvenance {
  /** Hand-written, as far as the text shows. */
  PROJECT = 'PROJECT',

  /** A `.min.css` name, or a line past `WEB_MINIFIED_LINE_LENGTH_THRESHOLD`. */
  MINIFIED = 'MINIFIED',
}
