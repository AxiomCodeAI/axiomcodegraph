from pkg45.base import Base45
from pkg46.util import decorate


class Base46(Base45):
    """Depth 46 in a cross-package inheritance chain."""

    kind = "base46"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 47

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg46"

    @classmethod
    def of(cls, value: int) -> "Base46":
        return cls(value)
