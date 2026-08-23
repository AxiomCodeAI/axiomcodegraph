from pkg16.base import Base16
from pkg16.util import Mixin16, combine


class Impl16_0(Mixin16, Base16):
    kind = "impl16_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl16_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl16_1(Mixin16, Base16):
    kind = "impl16_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl16_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl16_2(Mixin16, Base16):
    kind = "impl16_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl16_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build16(value: int) -> Impl16_0:
    return Impl16_0(value)
