from pkg55.base import Base55
from pkg56.util import decorate


class Base56(Base55):
    """Depth 56 in a cross-package inheritance chain."""

    kind = "base56"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 57

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg56"

    @classmethod
    def of(cls, value: int) -> "Base56":
        return cls(value)
