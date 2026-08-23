from pkg25.base import Base25
from pkg25.util import Mixin25, combine


class Impl25_0(Mixin25, Base25):
    kind = "impl25_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl25_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl25_1(Mixin25, Base25):
    kind = "impl25_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl25_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl25_2(Mixin25, Base25):
    kind = "impl25_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl25_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build25(value: int) -> Impl25_0:
    return Impl25_0(value)
