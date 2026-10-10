/**
 * Constants of the WEB front end: HTML documents and CSS stylesheets.
 *
 * HTML and CSS are one front end rather than two, because the two languages nest: a
 * `<style>` element is a stylesheet, a `style="…"` attribute is a declaration list, and a
 * `<link rel="stylesheet">` is a reference from one to the other. One analyzer walks both
 * extension sets and writes every relation once, so no two writers ever race on a CSS table.
 *
 * Neither language has a project shape of its own — a page sits in a Java resources folder,
 * a Django templates directory or a Vite root alike — so the front end is a FILE-TYPE
 * analyzer like XML and YAML: it walks every scan target and attributes each file to the most
 * specific project that contains it.
 */

/** Extensions read as HTML. `.xhtml` is XML by serialisation and HTML by vocabulary; the HTML grammar reads it. */
export const HTML_EXTENSIONS = ['.html', '.htm', '.xhtml'] as const;

/**
 * Extensions read as CSS. Preprocessor dialects (`.scss`, `.sass`, `.less`, `.styl`) are
 * deliberately absent: the CSS grammar is tolerant, but tolerance on a dialect it does not know
 * yields a tree that is wrong without saying so. A dialect is a separate front end.
 */
export const CSS_EXTENSIONS = ['.css'] as const;

/** `html_element.textContent`, `css_rule.preludeText` and `css_declaration.valueText` are cut here. */
export const WEB_TEXT_LIMIT = 1_024;

/** `html_attribute.value` is cut here: a data URI or an inline SVG attribute can run to megabytes. */
export const WEB_ATTRIBUTE_VALUE_LIMIT = 4_096;

/** `css_comment.text` and gap details are cut here. */
export const WEB_COMMENT_TEXT_LIMIT = 2_048;

/**
 * Parse gaps recorded per file before the rest are summarised into one row.
 *
 * A minified page or a template in a dialect the HTML parser does not know can
 * raise an error per tag. Each one is real, but ten thousand rows about one file
 * say less than two hundred plus a count, and the count is what the consumer needs
 * to decide whether to trust the file's other rows.
 */
export const WEB_PARSE_GAP_LIMIT = 200;

/**
 * A line longer than this marks a stylesheet or a page as MINIFIED output.
 *
 * Labelled, never skipped: the rows are still emitted in full and the label lets a
 * consumer exclude them from a denominator by column (the JavaScript front end's rule
 * for bundles). The threshold is the JavaScript one.
 */
export const WEB_MINIFIED_LINE_LENGTH_THRESHOLD = 5_000;

/** A `.min.css` / `.min.html` name is minified output whatever its line lengths are. */
export const WEB_MINIFIED_NAME_PATTERN = /\.min\.(css|html?)$/i;

/** CSV file names of the web relations, and the two skip reports. */
export const WEB_CSV_FILES = {
  HTML_DOCUMENTS: 'all-html-documents.csv',
  HTML_ELEMENTS: 'all-html-elements.csv',
  HTML_ATTRIBUTES: 'all-html-attributes.csv',
  HTML_CLASS_REFERENCES: 'all-html-class-references.csv',
  HTML_REFERENCES: 'all-html-references.csv',
  HTML_SCRIPTS: 'all-html-scripts.csv',
  HTML_HANDLER_CALLS: 'all-html-handler-calls.csv',
  HTML_TEMPLATE_EXPRESSIONS: 'all-html-template-expressions.csv',
  HTML_PARSE_GAPS: 'all-html-parse-gaps.csv',
  CSS_STYLESHEETS: 'all-css-stylesheets.csv',
  CSS_RULES: 'all-css-rules.csv',
  CSS_SELECTORS: 'all-css-selectors.csv',
  CSS_SELECTOR_PARTS: 'all-css-selector-parts.csv',
  CSS_DECLARATIONS: 'all-css-declarations.csv',
  CSS_VALUE_REFERENCES: 'all-css-value-references.csv',
  CSS_COMMENTS: 'all-css-comments.csv',
  CSS_PARSE_GAPS: 'all-css-parse-gaps.csv',
  SKIPPED_HTML_FILES: 'skipped-html-files.csv',
  SKIPPED_CSS_FILES: 'skipped-css-files.csv',
} as const;

/**
 * Above this many characters a file is parsed through tree-sitter's callback interface, in
 * chunks, to stay under the runtime's 32,767-character single-buffer ceiling. The same
 * threshold and chunk size as the Java and Python front ends (python-constants.ts explains
 * the two properties of the limit: characters not bytes, and the chunk carries the ceiling).
 */
export const WEB_CALLBACK_PARSE_THRESHOLD = 30_000;
export const WEB_PARSE_CHUNK_SIZE = 8_192;

/** Chunk size for CSV writes, matching the other analyzers. */
export const WEB_CSV_CHUNK_SIZE = 50_000;
