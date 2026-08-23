from pkg15.base import Base15
from pkg16.util import decorate


class Base16(Base15):
    """Depth 16 in a cross-package inheritance chain."""

    kind = "base16"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 17

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg16"

    @classmethod
    def of(cls, value: int) -> "Base16":
        return cls(value)
