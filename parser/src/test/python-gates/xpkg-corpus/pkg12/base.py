from pkg12.util import decorate


class Base12(object):
    """Depth 12 in a cross-package inheritance chain."""

    kind = "base12"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 13

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg12"

    @classmethod
    def of(cls, value: int) -> "Base12":
        return cls(value)
