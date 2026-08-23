from pkg11.base import Base11
from pkg11.util import Mixin11, combine


class Impl11_0(Mixin11, Base11):
    kind = "impl11_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl11_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl11_1(Mixin11, Base11):
    kind = "impl11_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl11_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl11_2(Mixin11, Base11):
    kind = "impl11_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl11_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build11(value: int) -> Impl11_0:
    return Impl11_0(value)
