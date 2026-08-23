from pkg49.base import Base49
from pkg50.util import decorate


class Base50(Base49):
    """Depth 50 in a cross-package inheritance chain."""

    kind = "base50"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 51

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg50"

    @classmethod
    def of(cls, value: int) -> "Base50":
        return cls(value)
