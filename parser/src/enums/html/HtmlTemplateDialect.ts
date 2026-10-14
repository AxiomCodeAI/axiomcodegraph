/**
 * A server- or client-side template syntax found in a page, by its MARKERS.
 *
 * An `.html` file is routinely not HTML alone: it is Jinja, Thymeleaf, Handlebars or
 * Razor around HTML. The HTML parser reads through the markers (they land in text and
 * attribute values), but a consumer must know the file is a template before it trusts
 * a URL or an id: `href="{{ url }}"` names nothing on disk. Several may hold at once,
 * so `html_document.templateDialects` is a comma set of these.
 *
 * Detection is by syntax, never by file name or directory, and it names the FAMILY a
 * marker belongs to rather than one engine: `{% %}` is Jinja, Django, Twig, Liquid and
 * Nunjucks alike, and nothing in the text distinguishes them.
 */
export enum HtmlTemplateDialect {
  /** `{{ … }}` interpolation: Mustache, Handlebars, Jinja, Django, Vue, Angular, Go templates. */
  MUSTACHE = 'MUSTACHE',

  /** `{% … %}` tags: Jinja, Django, Twig, Liquid, Nunjucks. */
  JINJA = 'JINJA',

  /** `{{#…}}` / `{{/…}}` / `{{>…}}` sections and partials: Handlebars, Mustache. */
  HANDLEBARS = 'HANDLEBARS',

  /** `<% … %>`, `<%= … %>`: ERB, EJS, JSP, classic ASP, Underscore. */
  ERB = 'ERB',

  /** `<?php … ?>` */
  PHP = 'PHP',

  /** `@model`, `@{ … }`, `@if`, `@foreach`, `@Html.`: Razor. */
  RAZOR = 'RAZOR',

  /** `th:*` attributes: Thymeleaf. */
  THYMELEAF = 'THYMELEAF',

  /** `*ngIf`, `[prop]`, `(event)`, `[(model)]`, `@if (…) {`: Angular. */
  ANGULAR = 'ANGULAR',

  /** `v-if`, `v-for`, `:prop`, `@event`, `v-bind`: Vue in a plain `.html`. */
  VUE = 'VUE',

  /** `${ … }` placeholders: FreeMarker, JSP EL, Thymeleaf inlining, Lit templates. */
  DOLLAR_BRACE = 'DOLLAR_BRACE',

  /** `x-data`, `x-on:`, `@click`, `x-bind`: Alpine.js. */
  ALPINE = 'ALPINE',

  /** `hx-get`, `hx-post`, `hx-target`: htmx. */
  HTMX = 'HTMX',

  /**
   * Server-side includes, `<!--#include virtual="…" -->`, `<!--#echo var="…" -->`, `<!--#set -->`, `<!--#if expr -->`
   * (Apache mod_include, nginx ssi): directives written as comments (G23).
   */
  SSI = 'SSI',
}
