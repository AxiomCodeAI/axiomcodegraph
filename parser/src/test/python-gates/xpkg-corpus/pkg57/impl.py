from pkg57.base import Base57
from pkg57.util import Mixin57, combine


class Impl57_0(Mixin57, Base57):
    kind = "impl57_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl57_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl57_1(Mixin57, Base57):
    kind = "impl57_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl57_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl57_2(Mixin57, Base57):
    kind = "impl57_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl57_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build57(value: int) -> Impl57_0:
    return Impl57_0(value)
