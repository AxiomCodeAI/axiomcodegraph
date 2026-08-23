from pkg24.base import Base24
from pkg24.util import Mixin24, combine


class Impl24_0(Mixin24, Base24):
    kind = "impl24_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl24_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl24_1(Mixin24, Base24):
    kind = "impl24_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl24_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl24_2(Mixin24, Base24):
    kind = "impl24_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl24_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build24(value: int) -> Impl24_0:
    return Impl24_0(value)
