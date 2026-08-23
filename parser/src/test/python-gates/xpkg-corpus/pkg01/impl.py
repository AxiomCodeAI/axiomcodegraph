from pkg01.base import Base01
from pkg01.util import Mixin01, combine


class Impl01_0(Mixin01, Base01):
    kind = "impl01_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl01_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl01_1(Mixin01, Base01):
    kind = "impl01_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl01_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl01_2(Mixin01, Base01):
    kind = "impl01_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl01_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build01(value: int) -> Impl01_0:
    return Impl01_0(value)
