"""Class declaration forms. Every call here resolves or is a builtin."""
import abc
import enum


class Plain:
    def label(self) -> str:
        return "plain"


class Derived(Plain):
    def label(self) -> str:
        return "derived"


class Multi(Plain, abc.ABC):
    def label(self) -> str:
        return "multi"


class WithSlots:
    __slots__ = ("x", "y")

    def __init__(self) -> None:
        self.x = 1
        self.y = 2


class Colour(enum.Enum):
    RED = 1
    GREEN = 2


class Meta(type):
    pass


class UsesMeta(metaclass=Meta):
    def label(self) -> str:
        return "meta"


class Nested:
    class Inner:
        def label(self) -> str:
            return "inner"


def exercise() -> str:
    return Derived().label() + Multi().label() + Nested.Inner().label()
