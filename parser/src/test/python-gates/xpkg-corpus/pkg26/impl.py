from pkg26.base import Base26
from pkg26.util import Mixin26, combine


class Impl26_0(Mixin26, Base26):
    kind = "impl26_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl26_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl26_1(Mixin26, Base26):
    kind = "impl26_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl26_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl26_2(Mixin26, Base26):
    kind = "impl26_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl26_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build26(value: int) -> Impl26_0:
    return Impl26_0(value)
