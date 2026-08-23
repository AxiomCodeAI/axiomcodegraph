from pkg45.base import Base45
from pkg45.util import Mixin45, combine


class Impl45_0(Mixin45, Base45):
    kind = "impl45_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl45_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl45_1(Mixin45, Base45):
    kind = "impl45_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl45_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl45_2(Mixin45, Base45):
    kind = "impl45_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl45_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build45(value: int) -> Impl45_0:
    return Impl45_0(value)
