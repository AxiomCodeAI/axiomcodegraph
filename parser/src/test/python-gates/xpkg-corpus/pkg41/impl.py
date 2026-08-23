from pkg41.base import Base41
from pkg41.util import Mixin41, combine


class Impl41_0(Mixin41, Base41):
    kind = "impl41_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl41_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl41_1(Mixin41, Base41):
    kind = "impl41_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl41_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl41_2(Mixin41, Base41):
    kind = "impl41_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl41_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build41(value: int) -> Impl41_0:
    return Impl41_0(value)
