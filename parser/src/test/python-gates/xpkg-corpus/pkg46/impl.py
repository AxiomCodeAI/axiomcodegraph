from pkg46.base import Base46
from pkg46.util import Mixin46, combine


class Impl46_0(Mixin46, Base46):
    kind = "impl46_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl46_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl46_1(Mixin46, Base46):
    kind = "impl46_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl46_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl46_2(Mixin46, Base46):
    kind = "impl46_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl46_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build46(value: int) -> Impl46_0:
    return Impl46_0(value)
