from pkg28.base import Base28
from pkg29.util import decorate


class Base29(Base28):
    """Depth 29 in a cross-package inheritance chain."""

    kind = "base29"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 30

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg29"

    @classmethod
    def of(cls, value: int) -> "Base29":
        return cls(value)
