/**
 * What a template expression DOES in its dialect, decided from the directive's name.
 *
 * `@click="select(item)"` in Vue, `(click)="select(item)"` in Angular and `x-on:click`
 * in Alpine are one thing to a consumer — a handler the framework runs on an event —
 * and the kind is what lets the three be asked for together. The directive as written
 * is kept beside it, so nothing is lost by the grouping.
 */
export enum HtmlTemplateExpressionKind {
  /** `{{ expr }}` in text: Vue, Angular, Handlebars, Jinja, Mustache. */
  INTERPOLATION = 'INTERPOLATION',

  /** `@event`, `v-on:event`, `x-on:event`, `(event)`, `th:onclick`: a handler the framework runs. */
  EVENT_HANDLER = 'EVENT_HANDLER',

  /** `:prop`, `v-bind:prop`, `x-bind:prop`, `[prop]`, `th:href`, `x-text`: a value bound to an attribute or property. */
  BINDING = 'BINDING',

  /** `v-if`, `v-else-if`, `v-show`, `x-if`, `x-show`, `*ngIf`, `th:if`, `th:unless`. */
  CONDITION = 'CONDITION',

  /** `v-for`, `x-for`, `*ngFor`, `th:each`: the expression introduces the names in `declares`. */
  LOOP = 'LOOP',

  /** `v-model`, `x-model`, `[(ngModel)]`: two-way binding. */
  MODEL = 'MODEL',

  /** `#name`, `v-slot:name`: a slot, whose props are in `declares`. */
  SLOT = 'SLOT',

  /** `#ref` (Angular), `x-ref`, `ref` with a Vue binding: a template reference variable. */
  REFERENCE = 'REFERENCE',

  /** `hx-get`, `hx-post`, …: a request the element makes; the URL is also an `html_reference` of kind REQUEST. */
  REQUEST = 'REQUEST',

  /** Any other directive of a known dialect: `v-once`, `x-data`, `x-init`, `th:text`, `*ngSwitch`, `hx-target`. */
  DIRECTIVE = 'DIRECTIVE',
}
