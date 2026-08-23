from pkg06.util import decorate


class Base06(object):
    """Depth 6 in a cross-package inheritance chain."""

    kind = "base06"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 7

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg06"

    @classmethod
    def of(cls, value: int) -> "Base06":
        return cls(value)
