/**
 * How an event is declared — `cs_event.eventKind`.
 *
 * ## Both forms are subscribed with `+=`, and neither is an assignment
 *
 * `button.Click += Handler` **calls the `add` accessor** and registers a call
 * edge that fires later. Modelling it as a compound assignment is §3's defect
 * class exactly: the parts are right, the structure is absent, and the engine
 * loses the edge. That is why `cs_expression` gives it a wrapper node with
 * `EVENT_SUBSCRIBE`, not `COMPOUND_ASSIGNMENT` with an operator column.
 *
 * The two forms differ in what the `add` accessor IS, which is why the kind is
 * recorded: a field-like event has a compiler-synthesized accessor with no
 * declaration syntax anywhere, and one with explicit accessors has real user
 * code that runs on every subscription.
 */
export enum CsEventKind {
  /**
   * `public event EventHandler Click;` — 130 measured.
   *
   * A hidden delegate field plus a synthesized `add`/`remove` pair. The
   * accessors exist and are called, and no `cs_method` row can point at a
   * declaration for them.
   */
  FIELD_LIKE = 'FIELD_LIKE',

  /**
   * `public event EventHandler Click { add { … } remove { … } }` — 67 measured.
   *
   * User code runs on every subscription, so `+=` is a call into a body the
   * parser can see.
   */
  WITH_ACCESSORS = 'WITH_ACCESSORS',
}
