/**
 * Attribute modifiers, emitted as a comma-set.
 *
 * `CLASS_VAR` versus `INSTANCE_VAR` is the load-bearing distinction: a class
 * attribute is shared by every instance, so a write through one instance is
 * visible from all of them, while an instance attribute is not.
 *
 * `PROPERTY_BACKED` marks the case where a name is BOTH a field and a method:
 * `@property def x` means `obj.x` is a call, and the engine needs to see both
 * candidates rather than one.
 *
 * Schema v6 §2.9 c12.
 */
export enum PythonFieldModifier {
  /** Declared in the class body — shared across instances. */
  CLASS_VAR = 'CLASS_VAR',
  /** Assigned through the receiver — per instance. */
  INSTANCE_VAR = 'INSTANCE_VAR',
  /** Declared in `__slots__`, so there is no instance `__dict__`. */
  SLOT = 'SLOT',
  /** Annotated `Final`. */
  FINAL = 'FINAL',
  /** Annotated `ClassVar[...]`, which makes the class/instance question explicit. */
  CLASSVAR_ANNOTATED = 'CLASSVAR_ANNOTATED',
  /** A `@property` exists for this name, so a read is a call. */
  PROPERTY_BACKED = 'PROPERTY_BACKED',
  /** A `dataclasses.field(...)` declaration. */
  DATACLASS_FIELD = 'DATACLASS_FIELD',
  /** An enum member. */
  ENUM_MEMBER = 'ENUM_MEMBER',
  /** Never written after initialisation, as far as the parser can see. */
  READ_ONLY = 'READ_ONLY',
}
