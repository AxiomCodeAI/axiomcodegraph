from pkg20.base import Base20
from pkg20.util import Mixin20, combine


class Impl20_0(Mixin20, Base20):
    kind = "impl20_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl20_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl20_1(Mixin20, Base20):
    kind = "impl20_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl20_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl20_2(Mixin20, Base20):
    kind = "impl20_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl20_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build20(value: int) -> Impl20_0:
    return Impl20_0(value)
