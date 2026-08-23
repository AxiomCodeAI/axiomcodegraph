from pkg42.base import Base42
from pkg43.util import decorate


class Base43(Base42):
    """Depth 43 in a cross-package inheritance chain."""

    kind = "base43"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 44

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg43"

    @classmethod
    def of(cls, value: int) -> "Base43":
        return cls(value)
