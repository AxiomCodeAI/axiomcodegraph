from pkg07.base import Base07
from pkg08.util import decorate


class Base08(Base07):
    """Depth 8 in a cross-package inheritance chain."""

    kind = "base08"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 9

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg08"

    @classmethod
    def of(cls, value: int) -> "Base08":
        return cls(value)
