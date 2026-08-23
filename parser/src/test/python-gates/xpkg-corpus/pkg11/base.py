from pkg10.base import Base10
from pkg11.util import decorate


class Base11(Base10):
    """Depth 11 in a cross-package inheritance chain."""

    kind = "base11"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 12

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg11"

    @classmethod
    def of(cls, value: int) -> "Base11":
        return cls(value)
