from pkg38.base import Base38
from pkg38.util import Mixin38, combine


class Impl38_0(Mixin38, Base38):
    kind = "impl38_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl38_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl38_1(Mixin38, Base38):
    kind = "impl38_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl38_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl38_2(Mixin38, Base38):
    kind = "impl38_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl38_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build38(value: int) -> Impl38_0:
    return Impl38_0(value)
