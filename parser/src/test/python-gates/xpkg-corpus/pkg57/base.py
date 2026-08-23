from pkg56.base import Base56
from pkg57.util import decorate


class Base57(Base56):
    """Depth 57 in a cross-package inheritance chain."""

    kind = "base57"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 58

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg57"

    @classmethod
    def of(cls, value: int) -> "Base57":
        return cls(value)
