from pkg40.base import Base40
from pkg41.util import decorate


class Base41(Base40):
    """Depth 41 in a cross-package inheritance chain."""

    kind = "base41"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 42

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg41"

    @classmethod
    def of(cls, value: int) -> "Base41":
        return cls(value)
