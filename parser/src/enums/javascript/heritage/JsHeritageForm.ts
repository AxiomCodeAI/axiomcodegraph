/**
 * How an inheritance edge was written. Schema §3.3 c2.
 *
 * ## In JavaScript an `extends` edge can be a function call
 *
 * That sentence is the reason `js_type_heritage` is a relation separate from
 * `js_type`, and it is §3 of `BUILDING-A-PARSER.md` in its purest form: *the
 * parts get emitted, the structure does not.* `util.inherits(Child, Parent)`
 * emits trivially as a call site with two identifier arguments. What it **is**
 * is an inheritance edge, and an extractor that only sees the call emits no
 * inheritance at all.
 *
 * Get this wrong and the engine sees **no inheritance in any pre-ES6
 * codebase** — not a degraded answer, an absent one.
 *
 * ## Do not size this work from the corpus counts
 *
 * `util.inherits` 2, `Object.create(B.prototype)` 4,
 * `Object.assign(X.prototype, …)` 2. Those numbers are a property of a corpus
 * where the runtime's standard library has been modernised, not of the language. A 2015-era corpus
 * inverts them, and the schema says so explicitly rather than letting the counts
 * argue for skipping the work.
 */
export enum JsHeritageForm {
  /** `class Child extends Parent`. The only form syntax states directly. */
  EXTENDS_CLAUSE = 'EXTENDS_CLAUSE',

  /**
   * `util.inherits(Child, Parent)`.
   *
   * An **extends edge expressed as a call**. Node's own pre-ES6 idiom, and
   * `require('util').inherits` reached through an alias is the normal spelling,
   * so recognition cannot depend on the receiver being literally named `util`.
   */
  UTIL_INHERITS = 'UTIL_INHERITS',

  /**
   * `Child.prototype = Object.create(Parent.prototype)`.
   *
   * The hand-rolled version of the same thing, and the one that appears without
   * any library dependency. Two statements usually follow it —
   * `Child.prototype.constructor = Child` and the members — and only this one
   * is the edge.
   */
  OBJECT_CREATE_PROTOTYPE = 'OBJECT_CREATE_PROTOTYPE',

  /**
   * `Child.prototype = new Parent()` or `Child.prototype = Parent.prototype`.
   *
   * The oldest and most broken form — it runs the parent constructor at
   * definition time, or shares one prototype object between two types. Still an
   * inheritance edge, and still what a great deal of shipped code does.
   */
  PROTOTYPE_ASSIGNMENT = 'PROTOTYPE_ASSIGNMENT',
}
