from pkg03.base import Base03
from pkg03.util import Mixin03, combine


class Impl03_0(Mixin03, Base03):
    kind = "impl03_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl03_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl03_1(Mixin03, Base03):
    kind = "impl03_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl03_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl03_2(Mixin03, Base03):
    kind = "impl03_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl03_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build03(value: int) -> Impl03_0:
    return Impl03_0(value)
