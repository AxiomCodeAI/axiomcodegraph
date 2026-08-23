from pkg27.base import Base27
from pkg27.util import Mixin27, combine


class Impl27_0(Mixin27, Base27):
    kind = "impl27_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl27_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl27_1(Mixin27, Base27):
    kind = "impl27_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl27_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl27_2(Mixin27, Base27):
    kind = "impl27_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl27_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build27(value: int) -> Impl27_0:
    return Impl27_0(value)
