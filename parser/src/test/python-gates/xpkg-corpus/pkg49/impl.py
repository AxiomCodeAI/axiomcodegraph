from pkg49.base import Base49
from pkg49.util import Mixin49, combine


class Impl49_0(Mixin49, Base49):
    kind = "impl49_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl49_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl49_1(Mixin49, Base49):
    kind = "impl49_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl49_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl49_2(Mixin49, Base49):
    kind = "impl49_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl49_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build49(value: int) -> Impl49_0:
    return Impl49_0(value)
