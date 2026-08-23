from pkg58.base import Base58
from pkg59.util import decorate


class Base59(Base58):
    """Depth 59 in a cross-package inheritance chain."""

    kind = "base59"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 60

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg59"

    @classmethod
    def of(cls, value: int) -> "Base59":
        return cls(value)
