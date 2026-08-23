from pkg26.base import Base26
from pkg27.util import decorate


class Base27(Base26):
    """Depth 27 in a cross-package inheritance chain."""

    kind = "base27"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 28

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg27"

    @classmethod
    def of(cls, value: int) -> "Base27":
        return cls(value)
