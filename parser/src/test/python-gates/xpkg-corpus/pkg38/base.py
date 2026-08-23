from pkg37.base import Base37
from pkg38.util import decorate


class Base38(Base37):
    """Depth 38 in a cross-package inheritance chain."""

    kind = "base38"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 39

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg38"

    @classmethod
    def of(cls, value: int) -> "Base38":
        return cls(value)
