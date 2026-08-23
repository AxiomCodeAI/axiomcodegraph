from pkg24.base import Base24
from pkg25.util import decorate


class Base25(Base24):
    """Depth 25 in a cross-package inheritance chain."""

    kind = "base25"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 26

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg25"

    @classmethod
    def of(cls, value: int) -> "Base25":
        return cls(value)
