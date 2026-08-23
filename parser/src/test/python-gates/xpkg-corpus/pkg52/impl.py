from pkg52.base import Base52
from pkg52.util import Mixin52, combine


class Impl52_0(Mixin52, Base52):
    kind = "impl52_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl52_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl52_1(Mixin52, Base52):
    kind = "impl52_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl52_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl52_2(Mixin52, Base52):
    kind = "impl52_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl52_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build52(value: int) -> Impl52_0:
    return Impl52_0(value)
