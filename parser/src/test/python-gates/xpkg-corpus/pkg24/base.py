from pkg24.util import decorate


class Base24(object):
    """Depth 24 in a cross-package inheritance chain."""

    kind = "base24"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 25

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg24"

    @classmethod
    def of(cls, value: int) -> "Base24":
        return cls(value)
