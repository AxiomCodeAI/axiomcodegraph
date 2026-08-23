from pkg28.base import Base28
from pkg28.util import Mixin28, combine


class Impl28_0(Mixin28, Base28):
    kind = "impl28_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl28_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl28_1(Mixin28, Base28):
    kind = "impl28_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl28_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl28_2(Mixin28, Base28):
    kind = "impl28_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl28_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build28(value: int) -> Impl28_0:
    return Impl28_0(value)
