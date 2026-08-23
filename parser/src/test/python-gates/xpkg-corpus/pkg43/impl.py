from pkg43.base import Base43
from pkg43.util import Mixin43, combine


class Impl43_0(Mixin43, Base43):
    kind = "impl43_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl43_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl43_1(Mixin43, Base43):
    kind = "impl43_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl43_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl43_2(Mixin43, Base43):
    kind = "impl43_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl43_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build43(value: int) -> Impl43_0:
    return Impl43_0(value)
