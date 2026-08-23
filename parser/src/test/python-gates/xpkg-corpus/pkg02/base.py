from pkg01.base import Base01
from pkg02.util import decorate


class Base02(Base01):
    """Depth 2 in a cross-package inheritance chain."""

    kind = "base02"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 3

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg02"

    @classmethod
    def of(cls, value: int) -> "Base02":
        return cls(value)
