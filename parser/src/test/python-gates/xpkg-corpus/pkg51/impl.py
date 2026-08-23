from pkg51.base import Base51
from pkg51.util import Mixin51, combine


class Impl51_0(Mixin51, Base51):
    kind = "impl51_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl51_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl51_1(Mixin51, Base51):
    kind = "impl51_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl51_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl51_2(Mixin51, Base51):
    kind = "impl51_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl51_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build51(value: int) -> Impl51_0:
    return Impl51_0(value)
