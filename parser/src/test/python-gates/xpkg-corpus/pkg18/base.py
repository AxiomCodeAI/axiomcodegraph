from pkg18.util import decorate


class Base18(object):
    """Depth 18 in a cross-package inheritance chain."""

    kind = "base18"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 19

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg18"

    @classmethod
    def of(cls, value: int) -> "Base18":
        return cls(value)
