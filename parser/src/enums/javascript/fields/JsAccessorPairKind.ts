/**
 * Whether reading or writing this name invokes a function. Schema §3.6 c12.
 *
 * ## The declaration side of a reserved call kind
 *
 * 1,225 getters and 137 setters were measured. Each one means that somewhere,
 * `obj.x` is **a function call written as a property read**.
 *
 * The parser can emit the declaration — a `get x() {}` is right there in the
 * syntax — and it cannot emit the invocation, because whether a given `obj.x`
 * hits an accessor depends on what `obj` turns out to be at runtime. So
 * `GETTER_INVOCATION` and `SETTER_INVOCATION` are reserved call kinds with a
 * zero-row assertion, and this column is the half syntax can answer.
 *
 * That split is the point: an engine that wants to model accessor invocation has
 * everything it needs on the declaration side and is told explicitly that the
 * call side was not guessed.
 */
export enum JsAccessorPairKind {
  /** An ordinary data property. A read is a read. */
  NONE = 'NONE',

  /** `get x()` with no setter. Writing it is a silent no-op in sloppy mode. */
  GETTER_ONLY = 'GETTER_ONLY',

  /** `set x(v)` with no getter. Reading it yields `undefined`. */
  SETTER_ONLY = 'SETTER_ONLY',

  /** Both. `getterMethodLinkHash` and `setterMethodLinkHash` are both populated. */
  GETTER_SETTER = 'GETTER_SETTER',
}
