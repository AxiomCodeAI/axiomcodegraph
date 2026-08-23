from pkg27.base import Base27
from pkg28.util import decorate


class Base28(Base27):
    """Depth 28 in a cross-package inheritance chain."""

    kind = "base28"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 29

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg28"

    @classmethod
    def of(cls, value: int) -> "Base28":
        return cls(value)
