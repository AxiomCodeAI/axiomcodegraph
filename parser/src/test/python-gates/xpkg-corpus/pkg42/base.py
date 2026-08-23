from pkg42.util import decorate


class Base42(object):
    """Depth 42 in a cross-package inheritance chain."""

    kind = "base42"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 43

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg42"

    @classmethod
    def of(cls, value: int) -> "Base42":
        return cls(value)
