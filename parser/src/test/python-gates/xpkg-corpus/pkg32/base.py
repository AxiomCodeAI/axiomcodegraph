from pkg31.base import Base31
from pkg32.util import decorate


class Base32(Base31):
    """Depth 32 in a cross-package inheritance chain."""

    kind = "base32"

    def __init__(self, value: int):
        super().__init__(value)
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return 33

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg32"

    @classmethod
    def of(cls, value: int) -> "Base32":
        return cls(value)
