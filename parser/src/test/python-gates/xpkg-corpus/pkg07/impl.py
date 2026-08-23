from pkg07.base import Base07
from pkg07.util import Mixin07, combine


class Impl07_0(Mixin07, Base07):
    kind = "impl07_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl07_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl07_1(Mixin07, Base07):
    kind = "impl07_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl07_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl07_2(Mixin07, Base07):
    kind = "impl07_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl07_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build07(value: int) -> Impl07_0:
    return Impl07_0(value)
