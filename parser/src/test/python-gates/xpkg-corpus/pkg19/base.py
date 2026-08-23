from pkg18.base import Base18
from pkg19.util import decorate


class Base19(Base18):
    """Depth 19 in a cross-package inheritance chain."""

    kind = "base19"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 20

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg19"

    @classmethod
    def of(cls, value: int) -> "Base19":
        return cls(value)
