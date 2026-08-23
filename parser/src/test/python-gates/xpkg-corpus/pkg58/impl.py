from pkg58.base import Base58
from pkg58.util import Mixin58, combine


class Impl58_0(Mixin58, Base58):
    kind = "impl58_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl58_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl58_1(Mixin58, Base58):
    kind = "impl58_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl58_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl58_2(Mixin58, Base58):
    kind = "impl58_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl58_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build58(value: int) -> Impl58_0:
    return Impl58_0(value)
