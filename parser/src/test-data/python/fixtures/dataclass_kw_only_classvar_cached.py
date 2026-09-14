"""3.10-specific dataclass features (`kw_only=` on both `field()` and the
class decorator, and the `KW_ONLY` sentinel), `typing.ClassVar` fields that
dataclass deliberately excludes from `__init__`, `__post_init__`, and
`functools.cached_property` — a descriptor that overwrites itself with a
plain instance attribute on first access, unlike `property`."""

from dataclasses import KW_ONLY, dataclass, field
from functools import cached_property
from typing import ClassVar


@dataclass
class Point:
    x: int
    y: int
    # ClassVar-annotated attributes are NOT treated as dataclass fields —
    # no __init__ parameter, no __repr__ entry, just an ordinary class
    # attribute that happens to carry a type annotation.
    dimensions: ClassVar[int] = 2


@dataclass
class Request:
    path: str
    # field-level kw_only=True (new in 3.10): this field is excluded from
    # the positional part of the generated __init__ even though it isn't
    # after a `*`-style marker in the source.
    method: str = field(default="GET", kw_only=True)
    timeout: float = field(default=5.0, kw_only=True)


@dataclass
class Query:
    table: str
    # the KW_ONLY sentinel (new in 3.10): every field declared after this
    # pseudo-field becomes keyword-only, without needing kw_only= on each one
    _: KW_ONLY
    limit: int = 100
    offset: int = 0


@dataclass(kw_only=True)
class StrictOptions:
    # class-level kw_only=True (new in 3.10): every field is keyword-only,
    # so field order no longer constrains default placement
    verbose: bool = False
    retries: int = 3


@dataclass
class NormalizedPoint:
    x: float
    y: float

    def __post_init__(self):
        magnitude = (self.x**2 + self.y**2) ** 0.5
        if magnitude:
            self.x /= magnitude
            self.y /= magnitude


class ExpensiveLookup:
    def __init__(self, source):
        self.source = source
        self._hits = 0

    @property
    def hit_count(self):
        # a plain property: re-invokes the getter on every access, and can
        # never become an instance attribute of the same name
        return self._hits

    @cached_property
    def parsed(self):
        # first access computes and stores the result directly in
        # self.__dict__['parsed'], so *after* that, `self.parsed` is a
        # genuine instance attribute shadowing this descriptor entirely —
        # a very different py_field/py_method duality than plain @property
        self._hits += 1
        return sorted(self.source)
