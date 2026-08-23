from pkg06.base import Base06
from pkg07.util import decorate


class Base07(Base06):
    """Depth 7 in a cross-package inheritance chain."""

    kind = "base07"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 8

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg07"

    @classmethod
    def of(cls, value: int) -> "Base07":
        return cls(value)
