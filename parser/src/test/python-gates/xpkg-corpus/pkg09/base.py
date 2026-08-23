from pkg08.base import Base08
from pkg09.util import decorate


class Base09(Base08):
    """Depth 9 in a cross-package inheritance chain."""

    kind = "base09"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 10

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg09"

    @classmethod
    def of(cls, value: int) -> "Base09":
        return cls(value)
