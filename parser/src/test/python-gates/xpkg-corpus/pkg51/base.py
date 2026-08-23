from pkg50.base import Base50
from pkg51.util import decorate


class Base51(Base50):
    """Depth 51 in a cross-package inheritance chain."""

    kind = "base51"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 52

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg51"

    @classmethod
    def of(cls, value: int) -> "Base51":
        return cls(value)
