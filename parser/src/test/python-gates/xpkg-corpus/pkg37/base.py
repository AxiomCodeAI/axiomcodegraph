from pkg36.base import Base36
from pkg37.util import decorate


class Base37(Base36):
    """Depth 37 in a cross-package inheritance chain."""

    kind = "base37"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 38

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg37"

    @classmethod
    def of(cls, value: int) -> "Base37":
        return cls(value)
