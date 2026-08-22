"""A4 audit fixture: the three things the human named — locals, fields, enums —
plus every neighbouring construct, so the audit says which are RESOLVED, which
are REPRESENTED ELSEWHERE, and which are ABSENT.

Every construct below is annotated with the relation that should carry it.
"""
import enum
from dataclasses import dataclass, field
from typing import ClassVar, Optional


# ---------------------------------------------------------------- enums
class Color(enum.Enum):            # py_type, typeCategory=ENUM_CLASS_TYPE
    RED = 1                        # enum MEMBER -> java_enum_constant analogue
    GREEN = 2
    BLUE = 3


class Flags(enum.IntFlag):
    NONE = 0
    READ = 1
    WRITE = 2


class Mode(str, enum.Enum):        # mixin enum, two bases
    RO = "ro"
    RW = "rw"


# ---------------------------------------------------------------- fields
class Account:
    TABLE: ClassVar[str] = "accounts"      # annotated CLASS field
    LIMIT = 1000                            # plain class field
    __slots__ = ("owner", "balance")        # declared instance slots

    def __init__(self, owner: str, balance: int = 0) -> None:
        self.owner = owner                  # instance field, first write
        self.balance = balance              # instance field
        self._audit: list[str] = []         # annotated instance field

    def deposit(self, amount: int) -> int:
        self.balance = self.balance + amount   # field WRITE (read + write)
        self._audit.append("deposit")          # field read, method call
        return self.balance


@dataclass
class Point:
    x: int                                  # dataclass field
    y: int = 0                              # dataclass field with default
    tags: list[str] = field(default_factory=list)


# ------------------------------------------------------------ local vars
def compute(seed: int, factor: float = 1.5) -> float:
    total = seed * factor            # local, inferable type from operands
    label = "result"                 # local, str literal
    items = [total, factor]          # local, list literal
    acc = Account("a", seed)         # local, type = Account (call to a class)
    for index, item in enumerate(items):   # two loop-target locals
        total = total + item
    with open("/dev/null") as handle:      # with-target local
        handle.read()
    try:
        pass
    except ValueError as err:              # except-target local, deleted at end
        print(err)
    (walrus := total)                      # walrus local
    del label                              # local deleted
    return acc.deposit(int(total)) + walrus


def annotated_locals() -> None:
    counter: int = 0                 # ANNOTATED local
    name: str                        # annotation-only local, never assigned
    counter += 1


class Service:
    registry: ClassVar[dict] = {}

    def run(self, mode: Mode = Mode.RO) -> Optional[str]:
        chosen = mode.value          # local whose type flows from a parameter
        self.registry[chosen] = 1    # class-field write through self
        return chosen
