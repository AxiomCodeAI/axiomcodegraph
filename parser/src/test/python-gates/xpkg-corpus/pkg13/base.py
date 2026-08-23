from pkg12.base import Base12
from pkg13.util import decorate


class Base13(Base12):
    """Depth 13 in a cross-package inheritance chain."""

    kind = "base13"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 14

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg13"

    @classmethod
    def of(cls, value: int) -> "Base13":
        return cls(value)
