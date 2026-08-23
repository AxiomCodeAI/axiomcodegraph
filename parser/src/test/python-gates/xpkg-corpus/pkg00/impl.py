from pkg00.base import Base00
from pkg00.util import Mixin00, combine


class Impl00_0(Mixin00, Base00):
    kind = "impl00_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl00_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl00_1(Mixin00, Base00):
    kind = "impl00_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl00_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl00_2(Mixin00, Base00):
    kind = "impl00_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl00_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build00(value: int) -> Impl00_0:
    return Impl00_0(value)
