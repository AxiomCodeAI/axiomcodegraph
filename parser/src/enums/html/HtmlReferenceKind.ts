/**
 * What a URL-bearing attribute points AT, decided from element and attribute together.
 *
 * `<script src>` and `<img src>` share an attribute name and mean entirely different
 * things to a consumer building a dependency graph: one is code the page runs, the
 * other is a byte stream it shows. The kind is what makes `html_reference` joinable to
 * the right table — SCRIPT to `js_module`, STYLESHEET to `css_stylesheet`, PAGE to
 * `html_document` — without the consumer re-deriving element semantics.
 */
export enum HtmlReferenceKind {
  /** `<script src>` — a script the page runs; `html_script` carries the rest. */
  SCRIPT = 'SCRIPT',

  /** `<link rel="stylesheet" href>` — a stylesheet the page applies. */
  STYLESHEET = 'STYLESHEET',

  /** `<link rel="modulepreload|preload|prefetch|icon|manifest|…" href>` — a resource hint or asset. */
  LINK_RESOURCE = 'LINK_RESOURCE',

  /** `<a href>`, `<area href>` — navigation. */
  ANCHOR = 'ANCHOR',

  /** `<img src>`, `<picture><source srcset>`, `<input type="image" src>`, `<img srcset>`. */
  IMAGE = 'IMAGE',

  /** `<video src>`, `<audio src>`, `<source src>`, `<track src>`, `<video poster>`. */
  MEDIA = 'MEDIA',

  /** `<iframe src>`, `<frame src>`, `<embed src>`, `<object data>` — an embedded document. */
  FRAME = 'FRAME',

  /** `<form action>`, `<button formaction>`, `<input formaction>` — where a submission goes. */
  FORM_ACTION = 'FORM_ACTION',

  /** `<base href>` — the base every relative URL in the page resolves against. */
  BASE = 'BASE',

  /** `<meta http-equiv="refresh" content="0; url=…">` — a redirect. */
  META_REFRESH = 'META_REFRESH',

  /** `hx-get="/api/items"`, `hx-post`, `hx-put`, `hx-patch`, `hx-delete` — a request the element makes at runtime. */
  REQUEST = 'REQUEST',

  /** `cite`, `ping`, `manifest`, `background`, `longdesc`, `profile`, `usemap`, `codebase`, `data`. */
  OTHER = 'OTHER',
}
