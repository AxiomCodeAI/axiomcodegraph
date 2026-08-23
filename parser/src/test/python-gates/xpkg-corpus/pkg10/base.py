from pkg09.base import Base09
from pkg10.util import decorate


class Base10(Base09):
    """Depth 10 in a cross-package inheritance chain."""

    kind = "base10"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 11

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg10"

    @classmethod
    def of(cls, value: int) -> "Base10":
        return cls(value)
