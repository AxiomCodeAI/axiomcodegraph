/**
 * How an attribute came to exist.
 *
 * Python has no field declarations, so an attribute is not one syntactic thing.
 * This is the column that records which mechanism created it, and it is part of
 * `py_field`'s identity — the same name arriving by two mechanisms is two facts,
 * not one.
 *
 * ## Examples
 *
 * ```python
 * class K:
 *     count = 0                  # CLASS_BODY_ASSIGN
 *     name: str                  # CLASS_BODY_ANNOTATION_ONLY
 *     __slots__ = ("a", "b")     # SLOTS_ENTRY, one per name
 *
 *     def __init__(self):
 *         self.conn = None       # SELF_ASSIGN
 *         self.hits += 1         # SELF_AUGASSIGN
 * ```
 *
 * Schema v6 §2.9 c13.
 */
export enum PythonFieldOrigin {
  /** Assigned in the class body — a class attribute. */
  CLASS_BODY_ASSIGN = 'CLASS_BODY_ASSIGN',
  /** Annotated in the class body with no value. */
  CLASS_BODY_ANNOTATION_ONLY = 'CLASS_BODY_ANNOTATION_ONLY',
  /** `self.x = ...` inside a method — 7,124 measured, only 67% in `__init__`. */
  SELF_ASSIGN = 'SELF_ASSIGN',
  /** `self.x += ...`, which both reads and writes. */
  SELF_AUGASSIGN = 'SELF_AUGASSIGN',
  /** A name listed in `__slots__`. */
  SLOTS_ENTRY = 'SLOTS_ENTRY',
  /** A `@dataclass` field — generated `__init__` takes these in order. */
  DATACLASS_FIELD = 'DATACLASS_FIELD',
  /** A `NamedTuple` field. */
  NAMEDTUPLE_FIELD = 'NAMEDTUPLE_FIELD',
  /** A `TypedDict` key. */
  TYPEDDICT_KEY = 'TYPEDDICT_KEY',
  /** An `Enum` member. */
  ENUM_MEMBER = 'ENUM_MEMBER',
  /** Created by `setattr` — the name may not be statically known. */
  SETATTR_DYNAMIC = 'SETATTR_DYNAMIC',
}
