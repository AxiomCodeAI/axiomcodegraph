from pkg17.base import Base17
from pkg17.util import Mixin17, combine


class Impl17_0(Mixin17, Base17):
    kind = "impl17_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl17_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl17_1(Mixin17, Base17):
    kind = "impl17_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl17_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl17_2(Mixin17, Base17):
    kind = "impl17_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl17_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build17(value: int) -> Impl17_0:
    return Impl17_0(value)
