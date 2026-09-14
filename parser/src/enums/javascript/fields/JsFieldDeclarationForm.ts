/**
 * How a member was declared. Schema §3.6 c3, and **in the primary key**.
 *
 * ## Why it is in the key
 *
 * `this.x = 1` in a constructor and `Foo.prototype.x = 1` at module level are
 * **two declarations of one member**, at different lines, and both are real —
 * one sets an own property per instance and the other sets a shared prototype
 * property. Keying without the form would merge them; keying with it keeps both,
 * and the engine can decide which it cares about.
 */
export enum JsFieldDeclarationForm {
  /** `class Foo { x = 1 }`. 614 measured. */
  CLASS_FIELD = 'CLASS_FIELD',

  /** `Foo.prototype.x = 1`. 233 measured. A shared property on the prototype. */
  PROTOTYPE_ASSIGNMENT = 'PROTOTYPE_ASSIGNMENT',

  /** `Foo.x = 1`. A static member, installed by assignment. */
  STATIC_ASSIGNMENT = 'STATIC_ASSIGNMENT',

  /**
   * `Object.defineProperty(Foo.prototype, 'x', { … })`. 76 measured.
   *
   * The only form that can declare a member non-writable or non-enumerable, and
   * the source of `isReadonly` — `writable: false` is a fact readable from the
   * descriptor literal and from nowhere else.
   */
  OBJECT_DEFINE_PROPERTY = 'OBJECT_DEFINE_PROPERTY',

  /**
   * `this.x = 1` inside a constructor or a constructor function.
   *
   * The dominant way pre-ES6 code declares instance state, and the reason the
   * field extractor has to look **inside a function body** for declarations
   * rather than only at a class body's members.
   */
  CONSTRUCTOR_THIS_ASSIGNMENT = 'CONSTRUCTOR_THIS_ASSIGNMENT',
}
