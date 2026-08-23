from pkg42.base import Base42
from pkg42.util import Mixin42, combine


class Impl42_0(Mixin42, Base42):
    kind = "impl42_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl42_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl42_1(Mixin42, Base42):
    kind = "impl42_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl42_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl42_2(Mixin42, Base42):
    kind = "impl42_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl42_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build42(value: int) -> Impl42_0:
    return Impl42_0(value)
