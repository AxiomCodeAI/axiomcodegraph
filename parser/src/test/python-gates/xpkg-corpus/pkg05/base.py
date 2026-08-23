from pkg04.base import Base04
from pkg05.util import decorate


class Base05(Base04):
    """Depth 5 in a cross-package inheritance chain."""

    kind = "base05"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 6

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg05"

    @classmethod
    def of(cls, value: int) -> "Base05":
        return cls(value)
