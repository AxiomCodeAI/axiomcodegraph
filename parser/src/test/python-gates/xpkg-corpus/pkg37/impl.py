from pkg37.base import Base37
from pkg37.util import Mixin37, combine


class Impl37_0(Mixin37, Base37):
    kind = "impl37_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl37_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl37_1(Mixin37, Base37):
    kind = "impl37_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl37_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl37_2(Mixin37, Base37):
    kind = "impl37_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl37_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build37(value: int) -> Impl37_0:
    return Impl37_0(value)
