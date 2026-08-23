from pkg19.base import Base19
from pkg19.util import Mixin19, combine


class Impl19_0(Mixin19, Base19):
    kind = "impl19_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl19_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl19_1(Mixin19, Base19):
    kind = "impl19_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl19_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl19_2(Mixin19, Base19):
    kind = "impl19_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl19_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build19(value: int) -> Impl19_0:
    return Impl19_0(value)
