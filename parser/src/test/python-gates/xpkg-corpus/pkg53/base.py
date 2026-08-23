from pkg52.base import Base52
from pkg53.util import decorate


class Base53(Base52):
    """Depth 53 in a cross-package inheritance chain."""

    kind = "base53"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 54

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg53"

    @classmethod
    def of(cls, value: int) -> "Base53":
        return cls(value)
