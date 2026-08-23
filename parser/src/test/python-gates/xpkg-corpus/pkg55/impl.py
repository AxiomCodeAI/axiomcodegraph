from pkg55.base import Base55
from pkg55.util import Mixin55, combine


class Impl55_0(Mixin55, Base55):
    kind = "impl55_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl55_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl55_1(Mixin55, Base55):
    kind = "impl55_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl55_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl55_2(Mixin55, Base55):
    kind = "impl55_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl55_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build55(value: int) -> Impl55_0:
    return Impl55_0(value)
