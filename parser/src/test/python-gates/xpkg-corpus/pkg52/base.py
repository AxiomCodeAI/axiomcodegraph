from pkg51.base import Base51
from pkg52.util import decorate


class Base52(Base51):
    """Depth 52 in a cross-package inheritance chain."""

    kind = "base52"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 53

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg52"

    @classmethod
    def of(cls, value: int) -> "Base52":
        return cls(value)
