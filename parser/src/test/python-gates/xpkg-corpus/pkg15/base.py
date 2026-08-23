from pkg14.base import Base14
from pkg15.util import decorate


class Base15(Base14):
    """Depth 15 in a cross-package inheritance chain."""

    kind = "base15"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 16

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg15"

    @classmethod
    def of(cls, value: int) -> "Base15":
        return cls(value)
