from pkg36.base import Base36
from pkg36.util import Mixin36, combine


class Impl36_0(Mixin36, Base36):
    kind = "impl36_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl36_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl36_1(Mixin36, Base36):
    kind = "impl36_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl36_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl36_2(Mixin36, Base36):
    kind = "impl36_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl36_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build36(value: int) -> Impl36_0:
    return Impl36_0(value)
