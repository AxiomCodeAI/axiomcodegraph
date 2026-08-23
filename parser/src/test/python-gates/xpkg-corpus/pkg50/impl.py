from pkg50.base import Base50
from pkg50.util import Mixin50, combine


class Impl50_0(Mixin50, Base50):
    kind = "impl50_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl50_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl50_1(Mixin50, Base50):
    kind = "impl50_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl50_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl50_2(Mixin50, Base50):
    kind = "impl50_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl50_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build50(value: int) -> Impl50_0:
    return Impl50_0(value)
