from pkg29.base import Base29
from pkg29.util import Mixin29, combine


class Impl29_0(Mixin29, Base29):
    kind = "impl29_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl29_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl29_1(Mixin29, Base29):
    kind = "impl29_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl29_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl29_2(Mixin29, Base29):
    kind = "impl29_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl29_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build29(value: int) -> Impl29_0:
    return Impl29_0(value)
