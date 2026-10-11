/**
 * What kind of URL a reference holds, decided from its TEXT alone.
 *
 * The same classification serves `html_reference` (`src`, `href`, `action`, …) and
 * `css_value_reference` (`url()`, `@import`): both are strings a browser would resolve
 * against the document, and both need the same first question answered — can this
 * name a file in the repository at all? Only RELATIVE and ROOT_RELATIVE can; the rest
 * are recorded as what they are, so a consumer can count external resources rather
 * than see them as unresolved.
 */
export enum WebUrlKind {
  /** `img/logo.png`, `../app.js`, `./x.css` — resolved against the file's directory. */
  RELATIVE = 'RELATIVE',

  /** `/static/app.js` — resolved against the served root, which the parser takes to be the project root. */
  ROOT_RELATIVE = 'ROOT_RELATIVE',

  /** `https://cdn.example/x.js`, `http://…` — another origin, never a repository file. */
  ABSOLUTE = 'ABSOLUTE',

  /** `//cdn.example/x.js` — scheme of the page, host of the URL. */
  PROTOCOL_RELATIVE = 'PROTOCOL_RELATIVE',

  /** `#section` — a same-document anchor; `targetFragment` carries the id. */
  FRAGMENT = 'FRAGMENT',

  /** `data:…` — the resource is inline in the attribute. */
  DATA_URI = 'DATA_URI',

  /** `javascript:…` — a script, not a location; its calls land in `html_handler_call`. */
  JAVASCRIPT_URI = 'JAVASCRIPT_URI',

  /** `mailto:`, `tel:`, `sms:`, `ftp:`, `file:`, a custom app scheme — not a web resource. */
  OTHER_SCHEME = 'OTHER_SCHEME',

  /**
   * `{{ asset('x') }}`, `<%= path %>`, `${url}`, `th:href` targets — a template produces
   * the URL at render time and the text here is not it. Recorded, never resolved.
   */
  TEMPLATE_EXPRESSION = 'TEMPLATE_EXPRESSION',

  /** `href=""` — legal, and means the document itself. */
  EMPTY = 'EMPTY',
}
