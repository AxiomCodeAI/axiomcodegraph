from pkg47.base import Base47
from pkg47.util import Mixin47, combine


class Impl47_0(Mixin47, Base47):
    kind = "impl47_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl47_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl47_1(Mixin47, Base47):
    kind = "impl47_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl47_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl47_2(Mixin47, Base47):
    kind = "impl47_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl47_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build47(value: int) -> Impl47_0:
    return Impl47_0(value)
