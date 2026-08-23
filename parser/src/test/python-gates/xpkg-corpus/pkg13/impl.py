from pkg13.base import Base13
from pkg13.util import Mixin13, combine


class Impl13_0(Mixin13, Base13):
    kind = "impl13_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl13_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl13_1(Mixin13, Base13):
    kind = "impl13_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl13_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl13_2(Mixin13, Base13):
    kind = "impl13_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl13_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build13(value: int) -> Impl13_0:
    return Impl13_0(value)
