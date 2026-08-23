from pkg33.base import Base33
from pkg34.util import decorate


class Base34(Base33):
    """Depth 34 in a cross-package inheritance chain."""

    kind = "base34"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 35

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg34"

    @classmethod
    def of(cls, value: int) -> "Base34":
        return cls(value)
