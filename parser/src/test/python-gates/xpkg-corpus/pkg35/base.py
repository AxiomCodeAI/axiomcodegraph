from pkg34.base import Base34
from pkg35.util import decorate


class Base35(Base34):
    """Depth 35 in a cross-package inheritance chain."""

    kind = "base35"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 36

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg35"

    @classmethod
    def of(cls, value: int) -> "Base35":
        return cls(value)
