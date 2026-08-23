from pkg44.base import Base44
from pkg45.util import decorate


class Base45(Base44):
    """Depth 45 in a cross-package inheritance chain."""

    kind = "base45"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 46

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg45"

    @classmethod
    def of(cls, value: int) -> "Base45":
        return cls(value)
