from pkg06.base import Base06
from pkg06.util import Mixin06, combine


class Impl06_0(Mixin06, Base06):
    kind = "impl06_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl06_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl06_1(Mixin06, Base06):
    kind = "impl06_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl06_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl06_2(Mixin06, Base06):
    kind = "impl06_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl06_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build06(value: int) -> Impl06_0:
    return Impl06_0(value)
