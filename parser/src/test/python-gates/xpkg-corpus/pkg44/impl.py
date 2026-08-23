from pkg44.base import Base44
from pkg44.util import Mixin44, combine


class Impl44_0(Mixin44, Base44):
    kind = "impl44_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl44_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl44_1(Mixin44, Base44):
    kind = "impl44_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl44_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl44_2(Mixin44, Base44):
    kind = "impl44_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl44_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build44(value: int) -> Impl44_0:
    return Impl44_0(value)
