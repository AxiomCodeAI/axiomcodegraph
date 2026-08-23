from pkg12.base import Base12
from pkg12.util import Mixin12, combine


class Impl12_0(Mixin12, Base12):
    kind = "impl12_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl12_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl12_1(Mixin12, Base12):
    kind = "impl12_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl12_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl12_2(Mixin12, Base12):
    kind = "impl12_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl12_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build12(value: int) -> Impl12_0:
    return Impl12_0(value)
