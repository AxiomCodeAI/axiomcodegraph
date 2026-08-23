from pkg20.base import Base20
from pkg21.util import decorate


class Base21(Base20):
    """Depth 21 in a cross-package inheritance chain."""

    kind = "base21"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 22

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg21"

    @classmethod
    def of(cls, value: int) -> "Base21":
        return cls(value)
