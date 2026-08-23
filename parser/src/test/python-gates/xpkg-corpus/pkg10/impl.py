from pkg10.base import Base10
from pkg10.util import Mixin10, combine


class Impl10_0(Mixin10, Base10):
    kind = "impl10_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl10_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl10_1(Mixin10, Base10):
    kind = "impl10_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl10_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl10_2(Mixin10, Base10):
    kind = "impl10_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl10_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build10(value: int) -> Impl10_0:
    return Impl10_0(value)
