from pkg08.base import Base08
from pkg08.util import Mixin08, combine


class Impl08_0(Mixin08, Base08):
    kind = "impl08_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl08_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl08_1(Mixin08, Base08):
    kind = "impl08_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl08_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl08_2(Mixin08, Base08):
    kind = "impl08_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl08_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build08(value: int) -> Impl08_0:
    return Impl08_0(value)
