from pkg35.base import Base35
from pkg35.util import Mixin35, combine


class Impl35_0(Mixin35, Base35):
    kind = "impl35_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl35_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl35_1(Mixin35, Base35):
    kind = "impl35_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl35_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl35_2(Mixin35, Base35):
    kind = "impl35_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl35_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build35(value: int) -> Impl35_0:
    return Impl35_0(value)
