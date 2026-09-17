/**
 * What a `cs_field` row actually is — `cs_field.memberKind`.
 *
 * Not every field is a field the programmer wrote. Two kinds are storage the
 * compiler creates, and an engine that cannot tell them apart will report
 * hand-written state where there is none.
 */
export enum CsFieldMemberKind {
  /** A field declared in source. */
  FIELD = 'FIELD',

  /**
   * The hidden delegate a FIELD-LIKE event stores its handlers in.
   *
   * `public event EventHandler Click;` compiles to a private delegate field
   * plus a synthesized `add`/`remove` pair. The field is real storage and it is
   * what a subscription mutates, but nobody wrote it.
   */
  EVENT_BACKING = 'EVENT_BACKING',

  /** An enum's underlying `value__` storage. Never written, always present. */
  ENUM_BACKING = 'ENUM_BACKING',
}
