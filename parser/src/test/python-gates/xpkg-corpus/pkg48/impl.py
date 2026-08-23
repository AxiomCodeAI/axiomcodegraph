from pkg48.base import Base48
from pkg48.util import Mixin48, combine


class Impl48_0(Mixin48, Base48):
    kind = "impl48_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl48_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl48_1(Mixin48, Base48):
    kind = "impl48_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl48_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl48_2(Mixin48, Base48):
    kind = "impl48_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl48_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build48(value: int) -> Impl48_0:
    return Impl48_0(value)
