/**
 * Modifiers on a callable — `cs_method.methodModifiers`, a sorted comma-set.
 *
 * A set rather than one kind per combination, per §3's "the variant in a field".
 * The load-bearing ones are also promoted to boolean columns so a rule need not
 * parse a comma-set.
 *
 * ## `REQUIRED` is deliberately NOT here
 *
 * `required` is legal only on a property or a field, and `cs_property` already
 * carries `isRequired` as a boolean. The value was therefore **unreachable in
 * every column that exists** — the enum audit reported it as declared and never
 * emitted, and the reason was structural rather than missing coverage. Ruled
 * out of this enum rather than given a column on a relation that does not need
 * one.
 *
 * `VOLATILE`, `CONST` and `FIXED` are gone for the same reason. They are FIELD
 * modifiers and `cs_field.fieldModifiers` carries them; keeping them here would
 * leave three values in an enum whose columns can never hold them, which is
 * what the audit reported in the first place.
 */
export enum CsMethodModifier {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  INTERNAL = 'INTERNAL',
  STATIC = 'STATIC',
  ABSTRACT = 'ABSTRACT',
  VIRTUAL = 'VIRTUAL',
  OVERRIDE = 'OVERRIDE',
  SEALED = 'SEALED',
  ASYNC = 'ASYNC',

  /** One declaration, one implementation, possibly in two files. */
  PARTIAL = 'PARTIAL',

  /** `extern` — the body is elsewhere, usually native. Still a call target. */
  EXTERN = 'EXTERN',

  UNSAFE = 'UNSAFE',

  /** `new` — hides an inherited member rather than overriding it. */
  NEW = 'NEW',

  /** `readonly` on a struct member — the member does not mutate `this`. */
  READONLY = 'READONLY',

  /** `ref` return: `ref int M()` hands back an alias, not a copy. */
  REF = 'REF',
}
