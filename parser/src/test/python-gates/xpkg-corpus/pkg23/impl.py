from pkg23.base import Base23
from pkg23.util import Mixin23, combine


class Impl23_0(Mixin23, Base23):
    kind = "impl23_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl23_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl23_1(Mixin23, Base23):
    kind = "impl23_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl23_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl23_2(Mixin23, Base23):
    kind = "impl23_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl23_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build23(value: int) -> Impl23_0:
    return Impl23_0(value)
