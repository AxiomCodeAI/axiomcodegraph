from pkg02.base import Base02
from pkg02.util import Mixin02, combine


class Impl02_0(Mixin02, Base02):
    kind = "impl02_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl02_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl02_1(Mixin02, Base02):
    kind = "impl02_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl02_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl02_2(Mixin02, Base02):
    kind = "impl02_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl02_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build02(value: int) -> Impl02_0:
    return Impl02_0(value)
