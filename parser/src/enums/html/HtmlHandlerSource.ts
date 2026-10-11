/** Where an `html_handler_call`'s text came from. */
export enum HtmlHandlerSource {
  /** An `on*` attribute: `onclick="save()"`. */
  EVENT_ATTRIBUTE = 'EVENT_ATTRIBUTE',

  /** A `javascript:` URL: `href="javascript:toggle()"`. */
  JAVASCRIPT_URL = 'JAVASCRIPT_URL',

  /**
   * A template dialect's event directive: `@click="select(item)"` (Vue, Alpine),
   * `(click)="onClick($event)"` (Angular). A bare name or member path there is the handler
   * the framework calls, so it is recorded as a call of it with no arguments, as Vue's own
   * compiler treats it.
   */
  TEMPLATE_EVENT = 'TEMPLATE_EVENT',
}
