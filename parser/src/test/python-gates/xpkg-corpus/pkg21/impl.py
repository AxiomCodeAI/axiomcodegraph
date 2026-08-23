from pkg21.base import Base21
from pkg21.util import Mixin21, combine


class Impl21_0(Mixin21, Base21):
    kind = "impl21_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl21_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl21_1(Mixin21, Base21):
    kind = "impl21_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl21_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl21_2(Mixin21, Base21):
    kind = "impl21_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl21_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build21(value: int) -> Impl21_0:
    return Impl21_0(value)
