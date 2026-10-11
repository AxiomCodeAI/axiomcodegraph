/**
 * What an attribute DOES, decided from its name (and for a few, its element).
 *
 * The kind is the column a consumer filters on: "every event handler in the page",
 * "every URL", "every template directive". It is deliberately coarse — a `data-*`
 * attribute is DATA whatever its suffix — because the suffix is the attribute's name
 * and the name column already carries it.
 */
export enum HtmlAttributeKind {
  /** `id` — the element's identity; also carried on `html_element.id`. */
  ID = 'ID',

  /** `class` — tokenised into `html_class_reference` rows as well. */
  CLASS = 'CLASS',

  /** `style` — a declaration list; its declarations are `css_declaration` rows. */
  STYLE = 'STYLE',

  /** `onclick`, `onload`, `onsubmit`, … — script text; its calls are `html_handler_call` rows. */
  EVENT_HANDLER = 'EVENT_HANDLER',

  /** `src`, `href`, `action`, `formaction`, `data`, `poster`, `cite`, `manifest`, `ping`, `background`. */
  URL = 'URL',

  /** `srcset`, `imagesrcset` — a comma list of URL candidates with descriptors. */
  SRCSET = 'SRCSET',

  /** `data-*` */
  DATA = 'DATA',

  /** `aria-*`, `role` */
  ARIA = 'ARIA',

  /** `for` on a label or output — names an element id. */
  FOR = 'FOR',

  /** `form`, `list`, `aria-labelledby`-style idrefs: `form`, `list`, `headers`, `usemap` (`#name`), `popovertarget`, `commandfor`. */
  ID_REFERENCE = 'ID_REFERENCE',

  /** `name` — the submit name of a control, the target name of a frame, the key of a meta. */
  NAME = 'NAME',

  /** `type` — the MIME type or control type. */
  TYPE = 'TYPE',

  /** `rel` — the relationship of a link or anchor. */
  REL = 'REL',

  /**
   * A template engine's attribute: `th:*`, `v-*`, `:x`, `@x`, `*ngX`, `[x]`, `(x)`,
   * `x-*` (Alpine), `hx-*` (htmx), `ng-*`, `data-bind` (Knockout), `wire:*` (Livewire),
   * `phx-*` (LiveView), `_` (hyperscript).
   */
  TEMPLATE_DIRECTIVE = 'TEMPLATE_DIRECTIVE',

  /** `xmlns`, `xmlns:*`, `xml:*` — namespace plumbing. */
  NAMESPACE = 'NAMESPACE',

  /** Anything else: `alt`, `title`, `width`, `disabled`, `value`, `placeholder`, … */
  OTHER = 'OTHER',
}
