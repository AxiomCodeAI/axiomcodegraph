from pkg54.util import decorate


class Base54(object):
    """Depth 54 in a cross-package inheritance chain."""

    kind = "base54"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 55

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg54"

    @classmethod
    def of(cls, value: int) -> "Base54":
        return cls(value)
