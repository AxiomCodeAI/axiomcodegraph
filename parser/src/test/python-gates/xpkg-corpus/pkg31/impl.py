from pkg31.base import Base31
from pkg31.util import Mixin31, combine


class Impl31_0(Mixin31, Base31):
    kind = "impl31_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl31_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl31_1(Mixin31, Base31):
    kind = "impl31_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl31_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl31_2(Mixin31, Base31):
    kind = "impl31_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl31_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build31(value: int) -> Impl31_0:
    return Impl31_0(value)
