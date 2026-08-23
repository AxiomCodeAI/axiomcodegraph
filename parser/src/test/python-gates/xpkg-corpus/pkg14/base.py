from pkg13.base import Base13
from pkg14.util import decorate


class Base14(Base13):
    """Depth 14 in a cross-package inheritance chain."""

    kind = "base14"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 15

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg14"

    @classmethod
    def of(cls, value: int) -> "Base14":
        return cls(value)
