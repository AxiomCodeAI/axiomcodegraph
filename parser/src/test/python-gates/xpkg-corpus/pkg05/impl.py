from pkg05.base import Base05
from pkg05.util import Mixin05, combine


class Impl05_0(Mixin05, Base05):
    kind = "impl05_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl05_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl05_1(Mixin05, Base05):
    kind = "impl05_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl05_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl05_2(Mixin05, Base05):
    kind = "impl05_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl05_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build05(value: int) -> Impl05_0:
    return Impl05_0(value)
