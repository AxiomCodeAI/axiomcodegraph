from pkg32.base import Base32
from pkg33.util import decorate


class Base33(Base32):
    """Depth 33 in a cross-package inheritance chain."""

    kind = "base33"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 34

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg33"

    @classmethod
    def of(cls, value: int) -> "Base33":
        return cls(value)
