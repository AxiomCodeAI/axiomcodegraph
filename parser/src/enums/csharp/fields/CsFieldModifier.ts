/**
 * Modifiers on a field — `cs_field.fieldModifiers`, a sorted comma-set.
 *
 * ## Three of these were UNREACHABLE until this relation existed
 *
 * `VOLATILE`, `CONST` and `FIXED` are field modifiers, and they were declared on
 * `CsMethodModifier` where no column could ever carry them. The enum audit
 * reported all three as declared and never emitted, and the cause was
 * structural rather than missing coverage — there was no `cs_field` to put them
 * on. They live here now.
 *
 * `REQUIRED` went the other way: it is legal only on a property or a field, and
 * `cs_property` already carries `isRequired` as a boolean, so adding a column to
 * a relation that does not need one was the worse trade. It was removed from the
 * method enum rather than rehomed.
 */
export enum CsFieldModifier {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  INTERNAL = 'INTERNAL',
  STATIC = 'STATIC',

  /** `readonly` — assignable only in a declaration or a constructor. */
  READONLY = 'READONLY',

  /**
   * `const` — a COMPILE-TIME constant, implicitly static, and **inlined at every
   * use site**. A reference to one may have no runtime read at all, which is the
   * same reachability problem TypeScript's `const enum` has.
   */
  CONST = 'CONST',

  /**
   * `volatile` — every read and write is a memory barrier.
   *
   * A concurrency fact, not a spelling one: a `volatile` field is the shared
   * state a race analysis is about.
   */
  VOLATILE = 'VOLATILE',

  /** `required` — must be set in an object initializer. */
  REQUIRED = 'REQUIRED',

  /** `fixed` — a fixed-size buffer in an unsafe struct. Inline storage, not a reference. */
  FIXED = 'FIXED',

  UNSAFE = 'UNSAFE',

  /** `new` — hides an inherited field of the same name. */
  NEW = 'NEW',
}
