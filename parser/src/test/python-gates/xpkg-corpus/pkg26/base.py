from pkg25.base import Base25
from pkg26.util import decorate


class Base26(Base25):
    """Depth 26 in a cross-package inheritance chain."""

    kind = "base26"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 27

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg26"

    @classmethod
    def of(cls, value: int) -> "Base26":
        return cls(value)
