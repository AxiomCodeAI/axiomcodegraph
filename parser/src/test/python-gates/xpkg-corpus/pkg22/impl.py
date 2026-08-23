from pkg22.base import Base22
from pkg22.util import Mixin22, combine


class Impl22_0(Mixin22, Base22):
    kind = "impl22_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl22_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl22_1(Mixin22, Base22):
    kind = "impl22_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl22_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl22_2(Mixin22, Base22):
    kind = "impl22_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl22_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build22(value: int) -> Impl22_0:
    return Impl22_0(value)
