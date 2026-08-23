from pkg40.base import Base40
from pkg40.util import Mixin40, combine


class Impl40_0(Mixin40, Base40):
    kind = "impl40_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl40_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl40_1(Mixin40, Base40):
    kind = "impl40_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl40_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl40_2(Mixin40, Base40):
    kind = "impl40_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl40_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build40(value: int) -> Impl40_0:
    return Impl40_0(value)
