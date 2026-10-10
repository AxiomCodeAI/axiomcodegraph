/** Where a `<script>` element's code is. */
export enum HtmlScriptKind {
  /** `<script src="…">` — the body, if any, is ignored by the browser and by this parser. */
  EXTERNAL = 'EXTERNAL',

  /** `<script>…</script>` — the body is the code; `bodyStartLine`…`bodyEndLine` locate it. */
  INLINE = 'INLINE',
}

/**
 * How the browser treats a `<script>` element's contents, from its `type` attribute.
 *
 * Decided by the HTML specification's rules for the `type` attribute: absent, empty or a
 * JavaScript MIME type is a classic script; `module` is a module; `importmap` and
 * `speculationrules` are JSON the browser reads; any other value is a data block the
 * browser ignores, which is how templating libraries hide templates in a page.
 */
export enum HtmlScriptType {
  /** No `type`, an empty one, or a JavaScript MIME type (`text/javascript`, `application/javascript`, …). */
  CLASSIC = 'CLASSIC',

  /** `type="module"` */
  MODULE = 'MODULE',

  /** `type="importmap"` — JSON mapping specifiers to URLs. */
  IMPORTMAP = 'IMPORTMAP',

  /** `type="speculationrules"` */
  SPECULATION_RULES = 'SPECULATION_RULES',

  /** `type="application/json"`, `application/ld+json` — data the page's scripts read. */
  JSON = 'JSON',

  /** `text/x-template`, `text/template`, `text/x-handlebars-template`, `text/html` — a client-side template. */
  TEMPLATE = 'TEMPLATE',

  /** `text/babel`, `text/jsx`, `text/typescript`, `text/coffeescript` — source a tool transforms first. */
  TRANSPILED = 'TRANSPILED',

  /** `text/x-mathjax-config`, a custom MIME type, anything else: a data block. */
  DATA_BLOCK = 'DATA_BLOCK',
}
