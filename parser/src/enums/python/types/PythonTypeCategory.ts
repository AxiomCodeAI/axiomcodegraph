/**
 * What kind of class a `class` statement declares.
 *
 * Python has one `class` keyword but many semantically distinct kinds, and the
 * distinctions change dispatch: a `NamedTuple` generates `__init__` in field
 * order, a `Protocol` member is never a call target, an `Enum` member is a
 * class attribute holding an instance of its own class.
 *
 * ## Examples
 *
 * ```python
 * class Service: ...                          # CLASS_TYPE
 * class MyError(ValueError): ...              # EXCEPTION_CLASS_TYPE
 * class Color(Enum): ...                      # ENUM_CLASS_TYPE
 * class Reader(Protocol): ...                 # PROTOCOL_TYPE
 * class Base(ABC): ...                        # ABC_TYPE
 * class Point(NamedTuple): ...                # NAMEDTUPLE_TYPE
 * class Config(TypedDict): ...                # TYPEDDICT_TYPE
 * @dataclass
 * class User: ...                             # DATACLASS_TYPE
 * class Meta(type): ...                        # METACLASS_TYPE
 * class Box(Generic[T]): ...                  # GENERIC_TYPE
 * ```
 *
 * Schema v6 §2.4 c3.
 */
export enum PythonTypeCategory {
  /** An ordinary class. */
  CLASS_TYPE = 'CLASS_TYPE',

  /** Inherits from `Exception` / `BaseException` or a known exception. */
  EXCEPTION_CLASS_TYPE = 'EXCEPTION_CLASS_TYPE',

  /** An `Enum`, `IntEnum`, `Flag`, or `StrEnum` subclass. */
  ENUM_CLASS_TYPE = 'ENUM_CLASS_TYPE',

  /** A `typing.Protocol` — structural typing; members are declarations. */
  PROTOCOL_TYPE = 'PROTOCOL_TYPE',

  /** An abstract base class: inherits `ABC` or uses `ABCMeta`. */
  ABC_TYPE = 'ABC_TYPE',

  /** A `typing.NamedTuple` or `collections.namedtuple` class. */
  NAMEDTUPLE_TYPE = 'NAMEDTUPLE_TYPE',

  /** A `typing.TypedDict`. */
  TYPEDDICT_TYPE = 'TYPEDDICT_TYPE',

  /** Decorated with `@dataclass` — `__init__` is generated in field order. */
  DATACLASS_TYPE = 'DATACLASS_TYPE',

  /** Inherits from `type` — instances of it are themselves classes. */
  METACLASS_TYPE = 'METACLASS_TYPE',

  /** Parameterised with `Generic[...]`. */
  GENERIC_TYPE = 'GENERIC_TYPE',
}
