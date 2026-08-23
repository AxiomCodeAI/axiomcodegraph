from pkg00.base import Base00
from pkg01.util import decorate


class Base01(Base00):
    """Depth 1 in a cross-package inheritance chain."""

    kind = "base01"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 2

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg01"

    @classmethod
    def of(cls, value: int) -> "Base01":
        return cls(value)
