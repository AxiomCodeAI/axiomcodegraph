from pkg00.util import decorate


class Base00(object):
    """Depth 0 in a cross-package inheritance chain."""

    kind = "base00"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 1

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg00"

    @classmethod
    def of(cls, value: int) -> "Base00":
        return cls(value)
