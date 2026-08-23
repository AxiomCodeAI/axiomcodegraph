from pkg54.base import Base54
from pkg54.util import Mixin54, combine


class Impl54_0(Mixin54, Base54):
    kind = "impl54_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl54_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl54_1(Mixin54, Base54):
    kind = "impl54_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl54_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl54_2(Mixin54, Base54):
    kind = "impl54_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl54_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build54(value: int) -> Impl54_0:
    return Impl54_0(value)
