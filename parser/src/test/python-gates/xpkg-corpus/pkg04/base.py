from pkg03.base import Base03
from pkg04.util import decorate


class Base04(Base03):
    """Depth 4 in a cross-package inheritance chain."""

    kind = "base04"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 5

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg04"

    @classmethod
    def of(cls, value: int) -> "Base04":
        return cls(value)
