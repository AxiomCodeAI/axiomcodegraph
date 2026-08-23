from pkg21.base import Base21
from pkg22.util import decorate


class Base22(Base21):
    """Depth 22 in a cross-package inheritance chain."""

    kind = "base22"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 23

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg22"

    @classmethod
    def of(cls, value: int) -> "Base22":
        return cls(value)
