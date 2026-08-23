from pkg04.base import Base04
from pkg04.util import Mixin04, combine


class Impl04_0(Mixin04, Base04):
    kind = "impl04_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl04_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl04_1(Mixin04, Base04):
    kind = "impl04_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl04_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl04_2(Mixin04, Base04):
    kind = "impl04_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl04_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build04(value: int) -> Impl04_0:
    return Impl04_0(value)
