from pkg16.base import Base16
from pkg17.util import decorate


class Base17(Base16):
    """Depth 17 in a cross-package inheritance chain."""

    kind = "base17"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 18

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg17"

    @classmethod
    def of(cls, value: int) -> "Base17":
        return cls(value)
