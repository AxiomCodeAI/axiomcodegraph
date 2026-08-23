from pkg59.base import Base59
from pkg59.util import Mixin59, combine


class Impl59_0(Mixin59, Base59):
    kind = "impl59_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl59_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl59_1(Mixin59, Base59):
    kind = "impl59_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl59_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl59_2(Mixin59, Base59):
    kind = "impl59_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl59_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build59(value: int) -> Impl59_0:
    return Impl59_0(value)
