from pkg33.base import Base33
from pkg33.util import Mixin33, combine


class Impl33_0(Mixin33, Base33):
    kind = "impl33_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl33_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl33_1(Mixin33, Base33):
    kind = "impl33_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl33_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl33_2(Mixin33, Base33):
    kind = "impl33_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl33_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build33(value: int) -> Impl33_0:
    return Impl33_0(value)
