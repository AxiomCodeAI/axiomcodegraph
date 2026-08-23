from pkg15.base import Base15
from pkg15.util import Mixin15, combine


class Impl15_0(Mixin15, Base15):
    kind = "impl15_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl15_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl15_1(Mixin15, Base15):
    kind = "impl15_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl15_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl15_2(Mixin15, Base15):
    kind = "impl15_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl15_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build15(value: int) -> Impl15_0:
    return Impl15_0(value)
