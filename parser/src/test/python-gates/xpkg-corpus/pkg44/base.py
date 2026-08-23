from pkg43.base import Base43
from pkg44.util import decorate


class Base44(Base43):
    """Depth 44 in a cross-package inheritance chain."""

    kind = "base44"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 45

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg44"

    @classmethod
    def of(cls, value: int) -> "Base44":
        return cls(value)
