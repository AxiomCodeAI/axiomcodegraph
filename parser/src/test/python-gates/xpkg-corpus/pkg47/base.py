from pkg46.base import Base46
from pkg47.util import decorate


class Base47(Base46):
    """Depth 47 in a cross-package inheritance chain."""

    kind = "base47"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 48

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg47"

    @classmethod
    def of(cls, value: int) -> "Base47":
        return cls(value)
