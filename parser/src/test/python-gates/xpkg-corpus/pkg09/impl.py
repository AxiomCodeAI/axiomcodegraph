from pkg09.base import Base09
from pkg09.util import Mixin09, combine


class Impl09_0(Mixin09, Base09):
    kind = "impl09_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl09_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl09_1(Mixin09, Base09):
    kind = "impl09_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl09_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl09_2(Mixin09, Base09):
    kind = "impl09_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl09_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build09(value: int) -> Impl09_0:
    return Impl09_0(value)
