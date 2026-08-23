from pkg30.base import Base30
from pkg30.util import Mixin30, combine


class Impl30_0(Mixin30, Base30):
    kind = "impl30_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl30_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl30_1(Mixin30, Base30):
    kind = "impl30_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl30_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl30_2(Mixin30, Base30):
    kind = "impl30_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl30_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build30(value: int) -> Impl30_0:
    return Impl30_0(value)
