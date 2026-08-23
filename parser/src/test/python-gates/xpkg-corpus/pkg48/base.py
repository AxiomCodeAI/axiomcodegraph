from pkg48.util import decorate


class Base48(object):
    """Depth 48 in a cross-package inheritance chain."""

    kind = "base48"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 49

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg48"

    @classmethod
    def of(cls, value: int) -> "Base48":
        return cls(value)
