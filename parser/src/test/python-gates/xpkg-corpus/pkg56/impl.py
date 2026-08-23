from pkg56.base import Base56
from pkg56.util import Mixin56, combine


class Impl56_0(Mixin56, Base56):
    kind = "impl56_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl56_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl56_1(Mixin56, Base56):
    kind = "impl56_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl56_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl56_2(Mixin56, Base56):
    kind = "impl56_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl56_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build56(value: int) -> Impl56_0:
    return Impl56_0(value)
