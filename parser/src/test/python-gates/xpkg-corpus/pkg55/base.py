from pkg54.base import Base54
from pkg55.util import decorate


class Base55(Base54):
    """Depth 55 in a cross-package inheritance chain."""

    kind = "base55"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 56

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg55"

    @classmethod
    def of(cls, value: int) -> "Base55":
        return cls(value)
