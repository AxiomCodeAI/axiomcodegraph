from pkg30.base import Base30
from pkg31.util import decorate


class Base31(Base30):
    """Depth 31 in a cross-package inheritance chain."""

    kind = "base31"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 32

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg31"

    @classmethod
    def of(cls, value: int) -> "Base31":
        return cls(value)
