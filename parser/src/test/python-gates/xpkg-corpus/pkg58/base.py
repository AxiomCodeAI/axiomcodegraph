from pkg57.base import Base57
from pkg58.util import decorate


class Base58(Base57):
    """Depth 58 in a cross-package inheritance chain."""

    kind = "base58"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 59

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg58"

    @classmethod
    def of(cls, value: int) -> "Base58":
        return cls(value)
