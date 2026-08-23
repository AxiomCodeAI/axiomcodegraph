from pkg36.util import decorate


class Base36(object):
    """Depth 36 in a cross-package inheritance chain."""

    kind = "base36"

    def __init__(self, value: int):
        self.base = value
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 37

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg36"

    @classmethod
    def of(cls, value: int) -> "Base36":
        return cls(value)
