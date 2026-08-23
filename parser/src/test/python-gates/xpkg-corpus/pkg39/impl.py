from pkg39.base import Base39
from pkg39.util import Mixin39, combine


class Impl39_0(Mixin39, Base39):
    kind = "impl39_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl39_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl39_1(Mixin39, Base39):
    kind = "impl39_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl39_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl39_2(Mixin39, Base39):
    kind = "impl39_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl39_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build39(value: int) -> Impl39_0:
    return Impl39_0(value)
